/**
 * =================================================================================================
 * COORDINATE SYSTEMS AND POSITIONING LOGIC DOCUMENTATION
 * =================================================================================================
 *
 * This class handles the complex task of pinning a `position: fixed` DOM element (the hover
 * editor) to a moving node in a Cytoscape graph. The logic has several non-obvious gotchas.
 *
 * -------------------------------------------------------------------------------------------------
 * 1. Core Coordinate Systems
 * -------------------------------------------------------------------------------------------------
 *
 * Cytoscape uses two primary coordinate systems:
 *
 * A) GRAPH COORDINATES (Model Space)
 *    - Obtained via: `node.position()`
 *    - Fixed coordinates that don't change with zoom/pan. A node at (200, 400) stays there.
 *    - Used for: The graph data model, layout algorithms, and storing state independent of view.
 *
 * B) RENDERED/SCREEN COORDINATES (View Space)
 *    - Obtained via: `node.renderedBoundingBox()`
 *    - Screen pixel coordinates that change with zoom/pan.
 *    - Used for: Mouse events, DOM positioning, and visual rendering.
 *
 * -------------------------------------------------------------------------------------------------
 * 2. Key Gotchas & Solutions
 * -------------------------------------------------------------------------------------------------
 *
 * This implementation solves several critical, non-obvious problems:
 *
 * GOTCHA #1: The "Drifting" Zoom Bug
 *   - PROBLEM: When zooming, the hover editor would drift horizontally. Panning worked fine.
 *   - ROOT CAUSE: A mismatch of coordinate system origins. The popover (`position: fixed`) is
 *     relative to the BROWSER VIEWPORT. However, `node.renderedBoundingBox()` returns coordinates
 *     relative to the CYTOSCAPE CONTAINER element. If the container is not flush with the
 *     viewport's edge (e.g., there's a sidebar), the origins differ. This error is scaled
 *     by the zoom, causing the drift.
 *   - SOLUTION: All positioning calculations must occur in a single, unified coordinate system.
 *     We standardize on the VIEWPORT system. We get the container's position using
 *     `cy.container().getBoundingClientRect()` and add its `left` and `top` values to the
 *     node's rendered coordinates to get the node's true position relative to the viewport.
 *
 * GOTCHA #2: Stuttering / Jank on Zoom ("Layout Thrashing")
 *   - PROBLEM: When multiple editors were open, zooming became choppy and slow.
 *   - ROOT CAUSE & solution: not yet known

 * GOTCHA #3: Inferring User Drag vs. Graph Movement
 *   - PROBLEM: How do you know if the editor's position changed because the user dragged it,
 *     or because the graph moved underneath it?
 *   - ROOT CAUSE: A naive check will see that the graph moved, see the editor is now in the "wrong"
 *     place, and incorrectly "correct" its position, creating a negative feedback loop where
 *     the editor fights against the graph's movement.
 *   - SOLUTION: Decouple the two concepts. The `onGraphChange` event handler is responsible for
 *     making the editor follow the graph. A separate, independent polling mechanism (`setInterval`)
 *     is used to detect user input. It periodically calculates the `expected` position based on
 *     our state. If the `actual` position in the DOM is different, we can be certain that an
 *     external force (the user) moved it, and we update our internal `offsetX`/`offsetY` state.
 *
 * -------------------------------------------------------------------------------------------------
 * 3. State Management
 * -------------------------------------------------------------------------------------------------
 *
 * - The `offsetX`, `offsetY`, `width`, and `height` are all stored in GRAPH coordinates.
 * - This makes the state zoom-independent and provides a stable "source of truth".
 * - To display the editor, we convert these graph units back to screen pixels at the current zoom.
 *
 * =================================================================================================
 */
import type { NodeSingular } from 'cytoscape';

/**
 * Converts a scalar value (like width or an offset delta) from screen units (pixels) to graph units.
 * @param screenValue - The value in screen pixels.
 * @param zoom - The current cytoscape zoom level.
 * @returns The value in graph units.
 */
function screenToGraph(screenValue: number, zoom: number): number {
    return screenValue / zoom;
}

/**
 * Converts a scalar value (like width or an offset delta) from graph units to screen units (pixels).
 * @param graphValue - The value in graph units.
 * @param zoom - The current cytoscape zoom level.
 * @returns The value in screen pixels.
 */
function graphToScreen(graphValue: number, zoom: number): number {
    return graphValue * zoom;
}

/**
 * Represents the state of the hover editor, stored in zoom-independent "graph" units.
 * This state is the single source of truth for the editor's position and size relative to the node.
 */
interface HoverEditorState {
    // The user-defined offset from the node's top-left corner, in graph coordinates.
    offsetX: number;
    offsetY: number;
    // The user-defined size of the editor, in graph coordinates.
    width: number;
    height: number;
}

interface TrackedEditor {
    node: NodeSingular;
    popoverEl: HTMLElement;
    state: HoverEditorState;
    resizeObserver: ResizeObserver;
    mutationObserver: MutationObserver;
    containerResizeObserver: ResizeObserver;
    windowResizeHandler: () => void;
    dragPollInterval: number;
    onGraphChange: () => void;
}

export class TerminalHoverEditorPositioning {
    private trackingMap: Map<string, TrackedEditor> = new Map();
    private static updatePending = false;
    private static sharedRAFId: number | null = null;
    private static instances: TerminalHoverEditorPositioning[] = [];
    
    constructor() {
        TerminalHoverEditorPositioning.instances.push(this);
    }
    
    /**
     * Shared update function that implements read/write separation
     */
    private static sharedUpdate() {
        // Collect all editors from all instances
        const allEditors: Array<{editor: TrackedEditor, instance: TerminalHoverEditorPositioning}> = [];
        for (const instance of TerminalHoverEditorPositioning.instances) {
            instance.trackingMap.forEach((editor) => {
                allEditors.push({editor, instance});
            });
        }
        
        if (allEditors.length === 0) {
            TerminalHoverEditorPositioning.updatePending = false;
            return;
        }
        
        // READ PHASE - Read all DOM values first
        const firstEditor = allEditors[0].editor;
        const cy = firstEditor.node.cy();
        const zoom = cy.zoom();
        const containerRect = cy.container().getBoundingClientRect();
        
        const updates: Array<{
            popoverEl: HTMLElement,
            x: number,
            y: number,
            width: number,
            height: number
        }> = [];
        
        // Read all node positions and calculate final positions
        allEditors.forEach(({editor}) => {
            const nodeBoundingBox = editor.node.renderedBoundingBox();
            const nodeViewportX = containerRect.left + nodeBoundingBox.x1;
            const nodeViewportY = containerRect.top + nodeBoundingBox.y1;
            
            const screenOffsetX = graphToScreen(editor.state.offsetX, zoom);
            const screenOffsetY = graphToScreen(editor.state.offsetY, zoom);
            
            updates.push({
                popoverEl: editor.popoverEl,
                x: nodeViewportX + screenOffsetX,
                y: nodeViewportY + screenOffsetY,
                width: graphToScreen(editor.state.width, zoom),
                height: graphToScreen(editor.state.height, zoom)
            });
        });
        
        // WRITE PHASE - Apply all updates at once
        updates.forEach(update => {
            update.popoverEl.style.position = 'fixed';
            update.popoverEl.style.left = `${update.x}px`;
            update.popoverEl.style.top = `${update.y}px`;
            update.popoverEl.style.width = `${update.width}px`;
            update.popoverEl.style.height = `${update.height}px`;
            update.popoverEl.style.zIndex = '1000';
        });
        
        TerminalHoverEditorPositioning.updatePending = false;
    }
    
    /**
     * Schedule a shared update for all editors
     */
    private static scheduleSharedUpdate() {
        if (!TerminalHoverEditorPositioning.updatePending) {
            TerminalHoverEditorPositioning.updatePending = true;
            TerminalHoverEditorPositioning.sharedRAFId = requestAnimationFrame(() => {
                TerminalHoverEditorPositioning.sharedUpdate();
            });
        }
    }

    pinHoverEditorToNode(terminalId: string, node: NodeSingular, popoverEl: HTMLElement): void {
        if (this.trackingMap.has(terminalId)) {
            this.cleanup(terminalId);
        }

        const cy = node.cy();
        let dragPollInterval: number;
        let updatePending = false;
        let containerResizeObserver: ResizeObserver;
        let windowResizeHandler: () => void;

        // Cache container rect with time-based refresh
        let cachedContainerRect = cy.container().getBoundingClientRect();
        let lastRectUpdate = Date.now();
        
        const getContainerRect = () => {
            const now = Date.now();
            if (now - lastRectUpdate > 300) {
                cachedContainerRect = cy.container().getBoundingClientRect();
                lastRectUpdate = now;
            }
            return cachedContainerRect;
        };
        

        // 1. INITIAL STATE SETUP
        // =================================================================
        const initialZoom = cy.zoom();
        const nodeBoundingBox = node.renderedBoundingBox();
        const popoverRect = popoverEl.getBoundingClientRect();

        // Convert node's container-relative position to viewport-relative position.
        const nodeViewportX = cachedContainerRect.left + nodeBoundingBox.x1;
        const nodeViewportY = cachedContainerRect.top + nodeBoundingBox.y1;

        // Calculate the initial offset in the viewport's coordinate system.
        const initialScreenOffsetX = popoverRect.left - nodeViewportX;
        const initialScreenOffsetY = popoverRect.top - nodeViewportY;

        // Apply 150% height multiplier for better visibility
        const adjustedHeight = popoverEl.offsetHeight * 1.5;
        
        const state: HoverEditorState = {
            offsetX: screenToGraph(initialScreenOffsetX, initialZoom),
            offsetY: screenToGraph(initialScreenOffsetY, initialZoom),
            width: screenToGraph(popoverEl.offsetWidth, initialZoom),
            height: screenToGraph(adjustedHeight, initialZoom),
        };

        // 2. CORE UPDATE AND EVENT LISTENER FUNCTIONS
        // =================================================================

        const updatePosition = () => {
            const zoom = cy.zoom();
            const containerRect = getContainerRect();
            const nodeBoundingBox = node.renderedBoundingBox();

            // Convert node's position to viewport coordinates.
            const nodeViewportX = containerRect.left + nodeBoundingBox.x1;
            const nodeViewportY = containerRect.top + nodeBoundingBox.y1;

            const screenOffsetX = graphToScreen(state.offsetX, zoom);
            const screenOffsetY = graphToScreen(state.offsetY, zoom);

            // Final position is relative to the viewport.
            const screenX = nodeViewportX + screenOffsetX;
            const screenY = nodeViewportY + screenOffsetY;

            const screenWidth = graphToScreen(state.width, zoom);
            const screenHeight = graphToScreen(state.height, zoom);

            popoverEl.style.position = 'fixed';
            popoverEl.style.left = `${screenX}px`;
            popoverEl.style.top = `${screenY}px`;
            popoverEl.style.width = `${screenWidth}px`;
            popoverEl.style.height = `${screenHeight}px`;
            popoverEl.style.zIndex = '1000';
        };

        const onGraphChange = () => {
            TerminalHoverEditorPositioning.scheduleSharedUpdate();
        };

        const pollForDrag = () => {
            const zoom = cy.zoom();
            const containerRect = getContainerRect();
            const nodeBoundingBox = node.renderedBoundingBox();

            // Calculate expected position in viewport coordinates.
            const nodeViewportX = containerRect.left + nodeBoundingBox.x1;
            const nodeViewportY = containerRect.top + nodeBoundingBox.y1;
            const expectedX = nodeViewportX + graphToScreen(state.offsetX, zoom);
            const expectedY = nodeViewportY + graphToScreen(state.offsetY, zoom);

            const actualX = parseFloat(popoverEl.style.left) || 0;
            const actualY = parseFloat(popoverEl.style.top) || 0;

            const threshold = 2;
            const dx = actualX - expectedX;
            const dy = actualY - expectedY;

            if (Math.abs(dx) > threshold || Math.abs(dy) > threshold) {
                state.offsetX += screenToGraph(dx, zoom);
                state.offsetY += screenToGraph(dy, zoom);
            }
        };

        const resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                const zoom = cy.zoom();
                state.width = screenToGraph(entry.contentRect.width, zoom);
                state.height = screenToGraph(entry.contentRect.height, zoom);
            }
        });

        const mutationObserver = new MutationObserver(() => {
            if (!document.body.contains(popoverEl)) {
                cleanup();
            }
        });

        const cleanup = () => {
            cy.off('viewport', onGraphChange);
            node.off('position', onGraphChange);
            resizeObserver.disconnect();
            mutationObserver.disconnect();
            containerResizeObserver.disconnect();
            window.removeEventListener('resize', windowResizeHandler);
            clearInterval(dragPollInterval);
            this.trackingMap.delete(terminalId);
        };

        // Update cache on container resize
        containerResizeObserver = new ResizeObserver(() => {
            cachedContainerRect = cy.container().getBoundingClientRect();
            lastRectUpdate = Date.now();
            // Use shared update to avoid resize loop
            TerminalHoverEditorPositioning.scheduleSharedUpdate();
        });
        
        // Update cache on window resize
        windowResizeHandler = () => {
            cachedContainerRect = cy.container().getBoundingClientRect();
            lastRectUpdate = Date.now();
            // Use shared update
            TerminalHoverEditorPositioning.scheduleSharedUpdate();
        };

        // Store the tracked editor
        const trackedEditor: TrackedEditor = {
            node,
            popoverEl,
            state,
            resizeObserver,
            mutationObserver,
            containerResizeObserver,
            windowResizeHandler,
            dragPollInterval: 0, // Will be set below
            onGraphChange
        };
        
        this.trackingMap.set(terminalId, trackedEditor);
        resizeObserver.observe(popoverEl);
        mutationObserver.observe(document.body, { childList: true, subtree: true });
        containerResizeObserver.observe(cy.container());
        window.addEventListener('resize', windowResizeHandler);
        
        // Initial position update using shared update
        TerminalHoverEditorPositioning.scheduleSharedUpdate();
        cy.on('viewport', onGraphChange);
        node.on('position', onGraphChange);
        trackedEditor.dragPollInterval = window.setInterval(pollForDrag, 200);
    }

    cleanup(terminalId: string): void {
        const trackedEditor = this.trackingMap.get(terminalId);
        if (trackedEditor) {
            const cy = trackedEditor.node.cy();
            cy.off('viewport', trackedEditor.onGraphChange);
            trackedEditor.node.off('position', trackedEditor.onGraphChange);
            trackedEditor.resizeObserver.disconnect();
            trackedEditor.mutationObserver.disconnect();
            trackedEditor.containerResizeObserver.disconnect();
            window.removeEventListener('resize', trackedEditor.windowResizeHandler);
            clearInterval(trackedEditor.dragPollInterval);
            this.trackingMap.delete(terminalId);
        }
    }

    cleanupAll(): void {
        const ids = Array.from(this.trackingMap.keys());
        ids.forEach(id => this.cleanup(id));
    }
}