import { Component, App, WorkspaceLeaf, getIcon } from 'obsidian';
import type { 
    IDataStore, 
    IJuggl, 
    IJugglPlugin 
} from 'juggl-api';
import { VizId } from 'juggl-api';
import { DataStoreEvents } from './events';
import type { NodeDefinition, EdgeDefinition, NodeCollection } from 'cytoscape';
import { TerminalHoverEditorPositioning } from './terminal-hover-editor-positioning';

// Terminal state interface - matches the structure from terminal plugin
interface TerminalState {
    id: string;
    name: string;
    profile: any; // Profile configuration
    cwd: string | null;
    status: 'active' | 'inactive' | 'error';
    workingDir?: string;
    command?: string;
    output?: string;
    timestamp: Date;
    leaf?: WorkspaceLeaf; // Associated workspace leaf
    sourceFile?: string; // The file this terminal is connected to
}

export class TerminalDataStore extends Component implements IDataStore {
    app: App;
    plugin: IJugglPlugin;
    events: DataStoreEvents;
    terminals: Map<string, TerminalState> = new Map();
    // Hover editor positioning manager
    hoverEditorPositioning: TerminalHoverEditorPositioning;

    constructor(plugin: IJugglPlugin) {
        super();
        this.plugin = plugin;
        this.app = plugin.app;
        this.events = new DataStoreEvents();
        this.hoverEditorPositioning = new TerminalHoverEditorPositioning();
    }

    getEvents(view: IJuggl): DataStoreEvents {
        return this.events;
    }

    storeId(): string {
        return 'terminal';
    }

    async getNeighbourhood(nodeIds: VizId[], viz: IJuggl): Promise<NodeDefinition[]> {
        const nodes: NodeDefinition[] = [];
        
        for (const nodeId of nodeIds) {
            if (nodeId.storeId === this.storeId()) {
                const terminal = this.terminals.get(nodeId.id);
                if (terminal) {
                    nodes.push(this.createNodeDefinition(terminal));
                }
            }
        }

        // Add some default terminal nodes for testing
        if (nodes.length === 0) {
            const defaultTerminals = [
                {
                    id: 'terminal-1',
                    name: 'Main Terminal',
                    profile: { name: 'bash' },
                    cwd: '/home/user',
                    status: 'active' as const,
                    workingDir: '/home/user',
                    command: 'ls -la',
                    timestamp: new Date()
                },
                {
                    id: 'terminal-2', 
                    name: 'Project Terminal',
                    profile: { name: 'zsh' },
                    cwd: '/workspace/project',
                    status: 'inactive' as const,
                    workingDir: '/workspace/project',
                    command: 'npm run dev',
                    timestamp: new Date()
                }
            ];

            for (const terminal of defaultTerminals) {
                this.terminals.set(terminal.id, terminal);
                nodes.push(this.createNodeDefinition(terminal));
            }
        }

        return nodes;
    }

    async connectNodes(allNodes: NodeCollection, newNodes: NodeCollection, viz: IJuggl): Promise<EdgeDefinition[]> {
        const edges: EdgeDefinition[] = [];
        
        // Create connections between terminals and files in their working directories
        // @ts-ignore
        for (const node of newNodes) {
            const nodeId = VizId.fromNode(node);
            if (nodeId.storeId === this.storeId()) {
                const terminal = this.terminals.get(nodeId.id);
                if (terminal && terminal.workingDir) {
                    // Find file nodes that might be in the terminal's working directory
                    // @ts-ignore
                    for (const otherNode of allNodes) {
                        const otherId = VizId.fromNode(otherNode);
                        if (otherId.storeId === 'core') {
                            // Create edge if file is related to terminal's working directory
                            edges.push({
                                group: 'edges',
                                data: {
                                    id: `${nodeId.toId()}->${otherId.toId()}`,
                                    source: nodeId.toId(),
                                    target: otherId.toId(),
                                    context: `Working in ${terminal.workingDir}`,
                                    edgeCount: 1,
                                    type: 'workingDir'
                                },
                                classes: ['terminal-file-relation', 'type-workingDir']
                            } as EdgeDefinition);
                        }
                    }
                }
            }
        }

        return edges;
    }

    async refreshNode(id: VizId, view: IJuggl): Promise<void> {
        if (id.storeId === this.storeId()) {
            const terminal = this.terminals.get(id.id);
            if (terminal && view.viz) {
                const node = view.viz.$id(id.toId());
                if (node.length > 0) {
                    // Update node data with current terminal state
                    node.data('status', terminal.status);
                    node.data('name', terminal.name);
                    
                    // Update visual classes based on status
                    node.removeClass('terminal-active terminal-inactive terminal-error');
                    node.addClass(`terminal-${terminal.status}`);
                }
            }
        }
    }

    private createNodeDefinition(terminal: TerminalState): NodeDefinition {
        return {
            group: 'nodes',
            data: {
                id: new VizId(terminal.id, this.storeId()).toId(),
                name: terminal.name,
                status: terminal.status,
                workingDir: terminal.workingDir,
                command: terminal.command,
                profile: terminal.profile?.name || 'terminal',
                timestamp: terminal.timestamp.toISOString(),
                sourceFile: terminal.sourceFile
            },
            classes: [
                'terminal-node',
                `terminal-${terminal.status}`,
                `profile-${terminal.profile?.name || 'default'} `,
                terminal.sourceFile ? 'terminal-connected' : 'terminal-standalone'
            ]
        };
    }

    // Method to add a new terminal
    addTerminal(terminal: TerminalState): void {
        this.terminals.set(terminal.id, terminal);
        this.events.trigger('createNode', terminal.id);
    }

    // Method to update terminal status
    updateTerminalStatus(id: string, status: TerminalState['status']): void {
        const terminal = this.terminals.get(id);
        if (terminal) {
            terminal.status = status;
            this.events.trigger('modifyNode', id);
        }
    }

    // Method to remove terminal
    removeTerminal(id: string): void {
        if (this.terminals.delete(id)) {
            this.events.trigger('deleteNode', id);
        }
    }

    async spawnTerminalInLeaf(terminalId: string, file?: TFile, extraEnv?: Record<string, string>): Promise<WorkspaceLeaf> {
        console.log(`[Juggl Debug] Spawning terminal leaf for ID: ${terminalId}`);
        const terminal = this.terminals.get(terminalId);
        if (!terminal) {
            console.error(`[Juggl Debug] Terminal ${terminalId} not found in store.`);
            return null;
        }

        const terminalPlugin = this.app.plugins.plugins['terminal'];
        if (!terminalPlugin) {
            console.error('[Juggl Debug] Terminal plugin not found.');
            return null;
        }

        // Write environment info to a file before spawning terminal
        if (file) {
            const vaultPath = (this.app.vault.adapter as any).basePath || '';
            
            // Build extra environment variables if provided
            let extraEnvExports = '';
            if (extraEnv) {
                for (const [key, value] of Object.entries(extraEnv)) {
                    extraEnvExports += `export ${key}="${value}"\n`;
                }
            }
            
            const envContent = `#!/bin/bash
# Obsidian Terminal Environment
# Generated by Juggl plugin at ${new Date().toISOString()}
# Source markdown: ${file.path}

export OBSIDIAN_SOURCE_NOTE="${file.path}"
export OBSIDIAN_SOURCE_BASENAME="${file.basename}"
export OBSIDIAN_SOURCE_NAME="${file.name}"
export OBSIDIAN_SOURCE_DIR="${file.parent.path}"
export OBSIDIAN_VAULT_PATH="${vaultPath}"

# Extra environment variables
${extraEnvExports}
# Display info
echo "Terminal opened from: ${file.name}"
echo "Full path: ${file.path}"
echo "Vault: ${vaultPath}"
echo "Use \\$OBSIDIAN_SOURCE_NOTE to reference the source file"
${extraEnv?.agent ? `echo "Agent: ${extraEnv.agent}"` : ''}
echo "─────────────────────────────────────────────"
`;
            
            // Write to a file in the vault's .obsidian directory
            const envPath = this.app.vault.configDir + '/.juggl_terminal_env';
            try {
                await this.app.vault.adapter.write(envPath, envContent);
                console.log(`[Juggl Debug] Wrote terminal env to: ${envPath}`);
            } catch (e) {
                console.error('[Juggl Debug] Failed to write terminal env file:', e);
            }
        }

        const leavesBefore = new Set(this.app.workspace.getLeavesOfType('terminal:terminal'));
        console.log(`[Juggl Debug] Found ${leavesBefore.size} terminal leaves before command.`);

        try {
            await this.app.commands.executeCommandById('terminal:open-terminal.integrated.root');

            let newLeaf: WorkspaceLeaf = null;
            for (let i = 0; i < 10; i++) {
                await new Promise(resolve => setTimeout(resolve, 100));
                const leavesAfter = this.app.workspace.getLeavesOfType('terminal:terminal');
                const foundLeaf = leavesAfter.find(leaf => !leavesBefore.has(leaf));
                if (foundLeaf) {
                    newLeaf = foundLeaf;
                    break;
                }
            }
            // THIS FOLLOWING CODE IS NOT WORKING
            if (newLeaf) {
                console.log(`[Juggl Debug] New terminal leaf identified: ${newLeaf.view.getViewType()}`);
                terminal.leaf = newLeaf;
                terminal.status = 'active';

                // IMPORTANT: The following code attempts to send commands to the terminal programmatically
                // but it doesn't work because:
                // 1. The terminal plugin doesn't expose a proper API to access the terminal object
                // 2. Even when we find the terminal object, terminal.write() only displays text but doesn't execute it
                // 3. We tried different control characters (\r, \n, \r\n) but none actually execute the command
                // 4. The terminal.write() method from xterm.js only writes to the display, not to the shell's stdin
                // 5. To actually execute commands, we'd need access to the underlying pseudoterminal process,
                //    which the terminal plugin doesn't expose
                // 
                // Instead, we use the print -z approach in .zshrc which pre-fills the command line and lets
                // the user press Enter to execute it.
                
                /*
                // Try to access the terminal from the leaf's view
                if (file && newLeaf.view) {
                    console.log(`[Juggl Debug] Checking for terminal in leaf.view...`);
                    
                    // Wait longer for terminal to fully initialize
                    setTimeout(() => {
                        const termView = newLeaf.view as any;
                        console.log(`[Juggl Debug] termView after delay:`, !!termView);
                        console.log(`[Juggl Debug] termView properties after delay:`, Object.keys(termView));
                        
                        // Check all properties recursively to find terminal
                        for (const prop of Object.keys(termView)) {
                            if (prop.includes('terminal') || prop.includes('emulator')) {
                                console.log(`[Juggl Debug] Found property ${prop}:`, !!termView[prop]);
                            }
                        }
                        
                        // Try to find the terminal in different locations
                        const terminal = termView.terminal || 
                                       termView.emulator?.terminal || 
                                       termView._terminal ||
                                       termView.terminalEmulator?.terminal ||
                                       termView.getTerminal?.();
                        
                        if (terminal) {
                            console.log(`[Juggl Debug] Terminal object found after delay!`);
                            console.log(`[Juggl Debug] terminal.write is function:`, typeof terminal.write === 'function');
                            
                            // Try different approaches to send the command
                            setTimeout(() => {
                            console.log(`[Juggl Debug] Attempting to send command to terminal`);
                            console.log(`[Juggl Debug] terminal exists:`, !!terminal);
                            console.log(`[Juggl Debug] terminal.write is function:`, typeof terminal.write === 'function');
                            
                            // Check if we should run an agent
                            if (extraEnv?.agent) {
                                const agentScript = extraEnv.agent === 'claude' 
                                    ? '/Users/bobbobby/repos/VoiceTree/tools/claude.sh'
                                    : '/Users/bobbobby/repos/VoiceTree/tools/gemini.sh';
                                
                                console.log(`[Juggl Debug] Running agent script: ${agentScript}`);
                                
                                try {
                                    // Use write method (the correct xterm.js method)
                                traversal fixup                                        console.log(`[Juggl Debug] Using terminal.write method`);
                                        // Try different control characters for Enter
                                        terminal.write(`${agentScript}\r`); // Just carriage return (Enter key)
                                        // Alternative: terminal.write(`${agentScript}\n`); // Just newline
                                        // Alternative: terminal.write(`${agentScript}\x0D`); // Hex code for CR
                                    } else {
                                        console.error(`[Juggl Debug] terminal.write method not available`);
                                    }
                                } catch (error) {
                                    console.error(`[Juggl Debug] Error sending command:`, error);
                                }
                            }
                            
                            // Change to directory
                            const dir = file.parent.path;
                            if (dir && terminal.write) {
                                console.log(`[Juggl Debug] Changing directory to: ${dir}`);
                                terminal.write(`cd "${dir}"\r`);
                            }
                            
                            // Run user-defined command if any
                            const command = this.plugin.settings?.terminalCommand;
                            if (command) {
                                const processedCommand = command
                                    .replace(/{{source_note_path}}/g, file.path)
                                    .replace(/{{source_note_name}}/g, file.name)
                                    .replace(/{{source_note_basename}}/g, file.basename);
                                
                                console.log(`[Juggl Debug] Running user command: ${processedCommand}`);
                                if (terminal.write) {
                                    terminal.write(`${processedCommand}\r`);
                                }
                            }
                        }, 1000); // Increased wait time
                        } else {
                            console.log(`[Juggl Debug] No terminal object found after delay`);
                        }
                    }, 2000); // Wait for terminal to initialize
                } else {
                    console.log(`[Juggl Debug] No file or newLeaf.view not available`);
                }
                */
                this.events.trigger('modifyNode', terminalId);
                return newLeaf;
            } else {
                console.error(`[Juggl Debug] Could not find new terminal leaf.`);
                terminal.status = 'error';
                this.events.trigger('modifyNode', terminalId);
                return null;
            }
        } catch (error) {
            console.error('[Juggl Debug] Error executing command to open terminal:', error);
            terminal.status = 'error';
            this.events.trigger('modifyNode', terminalId);
            return null;
        }
    }

    async spawnTerminalForHoverEditor(terminalId: string): Promise<WorkspaceLeaf> {
        console.log(`[Juggl Debug] Spawning clean terminal leaf for hover editor: ${terminalId}`);
        const terminal = this.terminals.get(terminalId);
        if (!terminal) {
            console.error(`[Juggl Debug] Terminal ${terminalId} not found in store.`);
            return null;
        }

        const terminalPlugin = this.app.plugins.plugins['terminal'];
        if (!terminalPlugin) {
            console.error('[Juggl Debug] Terminal plugin not found.');
            return null;
        }

        const leavesBefore = new Set(this.app.workspace.getLeavesOfType('terminal:terminal'));
        
        try {
            await this.app.commands.executeCommandById('terminal:open-terminal.integrated.root');

            let newLeaf: WorkspaceLeaf = null;
            for (let i = 0; i < 10; i++) {
                await new Promise(resolve => setTimeout(resolve, 100));
                const leavesAfter = this.app.workspace.getLeavesOfType('terminal:terminal');
                const foundLeaf = leavesAfter.find(leaf => !leavesBefore.has(leaf));
                if (foundLeaf) {
                    newLeaf = foundLeaf;
                    break;
                }
            }

            if (newLeaf) {
                console.log(`[Juggl Debug] New clean terminal leaf identified: ${newLeaf.view.getViewType()}`);
                terminal.leaf = newLeaf;
                terminal.status = 'active';
                this.events.trigger('modifyNode', terminalId);
                return newLeaf;
            } else {
                console.error(`[Juggl Debug] Could not find new clean terminal leaf.`);
                terminal.status = 'error';
                this.events.trigger('modifyNode', terminalId);
                return null;
            }
        } catch (error) {
            console.error('[Juggl Debug] Error executing command to open clean terminal:', error);
            terminal.status = 'error';
            this.events.trigger('modifyNode', terminalId);
            return null;
        }
    }

    // Method to convert terminal leaf to hover editor
    async convertTerminalToHoverEditor(terminalId: string, node?: any): Promise<void> {
        console.log(`[Juggl Debug] Converting terminal to hover editor: ${terminalId}`);
        const terminal = this.terminals.get(terminalId);
        if (!terminal) {
            console.error('[Juggl Debug] Terminal not found for conversion:', terminalId);
            return;
        }

        const hoverEditorPlugin = this.app.plugins.plugins['obsidian-hover-editor'];
        if (!hoverEditorPlugin) {
            console.error('[Juggl Debug] Hover Editor plugin not found.');
            return;
        }

        let leafToConvert = terminal.leaf;

        // If the leaf doesn't exist or is invalid, spawn a new one using the clean method.
        if (!leafToConvert || leafToConvert.view.getViewType() !== 'terminal:terminal') {
            console.log('[Juggl Debug] No valid leaf found. Spawning new clean terminal for hover editor...');
            leafToConvert = await this.spawnTerminalForHoverEditor(terminalId);
            if (!leafToConvert) {
                console.error('[Juggl Debug] Failed to spawn clean terminal for hover editor.');
                return;
            }
        }
        
        console.log(`[Juggl Debug] Leaf to convert: ${leafToConvert.view.getViewType()}`);

        try {
            if (hoverEditorPlugin.convertLeafToPopover && typeof hoverEditorPlugin.convertLeafToPopover === 'function') {
                await hoverEditorPlugin.convertLeafToPopover(leafToConvert);
                console.log(`[Juggl Debug] Terminal ${terminalId} converted to hover editor.`);
                
                // Apply 50% height increase after a short delay to ensure rendering
                const HEIGHT_MULTIPLIER = 1.5;
                
                // Wait for hover editor to fully render
                setTimeout(() => {
                    // Find the newly created hover editor
                    const selectors = ['.hover-editor', '.popover.hover-popover', '.hover-editor-popover'];
                    let popover: HTMLElement | null = null;
                    
                    for (const selector of selectors) {
                        const popovers = document.querySelectorAll(selector);
                        if (popovers.length > 0) {
                            popover = popovers[popovers.length - 1] as HTMLElement;
                            break;
                        }
                    }
                    
                    if (popover) {
                        // Check if terminal content has loaded
                        const terminalContent = popover.querySelector('.terminal');
                        if (terminalContent) {
                            // Get the computed height after terminal has rendered
                            const computedStyle = window.getComputedStyle(popover);
                            const currentHeight = parseFloat(computedStyle.height);
                            
                            // Only apply multiplier if we have a reasonable height
                            if (currentHeight > 50) {
                                popover.style.height = `${currentHeight * HEIGHT_MULTIPLIER}px`;
                                console.log(`[Juggl Debug] Applied height multiplier: ${currentHeight}px -> ${currentHeight * HEIGHT_MULTIPLIER}px`);
                            } else {
                                // If still too small, set a reasonable default
                                const defaultHeight = 400 * HEIGHT_MULTIPLIER;
                                popover.style.height = `${defaultHeight}px`;
                                console.log(`[Juggl Debug] Height too small (${currentHeight}px), using default: ${defaultHeight}px`);
                            }
                        } else {
                            console.log('[Juggl Debug] Terminal content not yet loaded in popover');
                        }
                    } else {
                        console.error('[Juggl Debug] Could not find hover editor popover to resize. Possible reasons:');
                        console.error('  - The hover editor DOM element uses a different CSS class than expected');
                        console.error('  - The conversion is async and popover not yet in DOM');
                        console.error('  - The hover editor plugin version has changed its implementation');
                        console.log('[Juggl Debug] Searched for selectors:', selectors);
                        console.log('[Juggl Debug] All popovers in DOM:', document.querySelectorAll('.popover'));
                    }
                }, 600); // 300ms delay to allow terminal to render
                
                // If we have a node, try to pin the hover editor to it
                if (node) {
                    // The new positioning function is synchronous and needs the HTMLElement.
                    // We must find the element first before calling the function.
                    setTimeout(() => {
                        const selectors = ['.hover-editor', '.popover.hover-popover', '.hover-editor-popover'];
                        let popoverEl: HTMLElement | null = null;
                        
                        for (const selector of selectors) {
                            const popovers = document.querySelectorAll(selector);
                            if (popovers.length > 0) {
                                popoverEl = popovers[popovers.length - 1] as HTMLElement;
                                break;
                            }
                        }

                        if (popoverEl) {
                            console.log(`[Juggl Debug] Found popover element. Pinning to node.`);
                            this.hoverEditorPositioning.pinHoverEditorToNode(terminalId, node, popoverEl);
                        } else {
                            console.error(`[Juggl Debug] Could not find hover editor popover element to pin.`);
                        }
                    }, 500); // Wait for popover to be created and rendered.
                }
            } else {
                console.error('[Juggl Debug] convertLeafToPopover method not found on hover editor plugin.');
            }
        } catch (error) {
            console.error('[Juggl Debug] Error converting terminal to hover editor:', error);
        }
    }

    // Method to spawn terminal connected to a specific file
    async spawnTerminalForFile(fileName: string, sourceNode?: any, extraEnv?: Record<string, string>): Promise<void> {
        const file = this.app.metadataCache.getFirstLinkpathDest(fileName, '');
        if (!file) {
            console.error(`File not found: ${fileName}`);
            return;
        }

        const filePath = file.path;
        const fileDir = filePath.substring(0, filePath.lastIndexOf('/')) || '/';

        const terminalId = `terminal-${fileName}-${Date.now()}`;
        const terminalState: TerminalState = {
            id: terminalId,
            name: `Terminal: ${fileName}`,
            profile: { type: "integrated" },
            cwd: fileDir,
            status: 'active',
            workingDir: fileDir,
            command: `cd "${fileDir}"`,
            timestamp: new Date(),
            sourceFile: fileName
        };

        this.terminals.set(terminalId, terminalState);

        // Spawn terminal immediately with environment variables set
        await this.spawnTerminalInLeaf(terminalId, file, extraEnv);

        this.plugin.activeGraphs().forEach(async (graph) => {
            if (graph && graph.viz) {
                const terminalNodeDef = this.createNodeDefinition(terminalState);
                
                // If we have a source node, add linkedNodeIds to help with positioning
                if (sourceNode) {
                    const sourceId = VizId.fromNode(sourceNode).toId();
                    const sourceVizId = VizId.fromNode(sourceNode);
                    // Use the full VizId string format that includes store ID
                    terminalNodeDef.data.linkedNodeIds = [sourceId];
                    console.log('[Juggl Terminal Debug] Source node ID:', sourceId);
                    console.log('[Juggl Terminal Debug] Source VizId:', sourceVizId);
                    console.log('[Juggl Terminal Debug] Terminal node def with linkedNodeIds:', terminalNodeDef);
                } else {
                    console.log('[Juggl Terminal Debug] No source node provided!');
                }
                
                console.log('[Juggl Terminal Debug] Calling mergeToGraph for terminal node');
                // Use mergeToGraph for proper positioning
                const mergeResult = graph.mergeToGraph([terminalNodeDef], true, false);
                const terminalNode = mergeResult.added.nodes()[0];
                console.log('[Juggl Terminal Debug] Terminal node added:', terminalNode?.id());
                
                if (sourceNode && terminalNode) {
                    const sourceId = VizId.fromNode(sourceNode).toId();
                    const terminalId = new VizId(terminalState.id, this.storeId()).toId();
                    
                    const edge = {
                        group: 'edges',
                        data: {
                            id: `${sourceId}->${terminalId}`,
                            source: sourceId,
                            target: terminalId,
                            context: `Terminal for ${fileName}`,
                            edgeCount: 1,
                            type: 'terminal'
                        },
                        classes: ['terminal-connection', 'type-terminal']
                    };
                    
                    console.log('[Juggl Terminal Debug] Adding edge from', sourceId, 'to', terminalId);
                    // Also use mergeToGraph for the edge
                    graph.mergeToGraph([edge], true, false);
                }

                console.log('[Juggl Terminal Debug] Triggering onGraphChanged');
                graph.onGraphChanged(true, true);
            }
        });
    }

    onunload() {
        // Clean up all hover editor tracking
        this.hoverEditorPositioning.cleanupAll();
        super.onunload();
    }
}