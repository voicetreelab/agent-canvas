import { BreathingAnimationManager, AnimationType } from './breathing-animation';
import type { NodeSingular, NodeCollection } from 'cytoscape';

// Enhanced Mock Node with cy() support for timeout functionality
class MockNode {
  private data: Map<string, any> = new Map();
  private styles: Map<string, any> = new Map();
  private _id: string;
  private mockCy: any;

  constructor(id: string, cy?: any) {
    this._id = id;
    this.mockCy = cy || {
      getElementById: (id: string) => (id === this._id ? this : { length: 0 })
    };
  }

  id(): string {
    return this._id;
  }

  cy(): any {
    return this.mockCy;
  }

  data(key?: string, value?: any): any {
    if (key === undefined) {
      return Object.fromEntries(this.data);
    }
    if (value !== undefined) {
      this.data.set(key, value);
      return this;
    }
    return this.data.get(key);
  }

  removeData(keys: string): void {
    keys.split(' ').forEach(key => this.data.delete(key));
  }

  style(key?: string | object, value?: any): any {
    if (typeof key === 'object') {
      Object.entries(key).forEach(([k, v]) => this.styles.set(k, v));
      return this;
    }
    if (key === undefined) {
      return Object.fromEntries(this.styles);
    }
    if (value !== undefined) {
      this.styles.set(key, value);
      return this;
    }
    return this.styles.get(key);
  }

  animation(config: any): any {
    const self = this;
    return {
      play: () => ({
        promise: (type: string) => {
          if (type === 'completed') {
            return new Promise(resolve => {
              setTimeout(() => {
                if (self.data.get('breathingActive')) {
                  Object.entries(config.style).forEach(([k, v]) => {
                    self.styles.set(k, v);
                  });
                }
                resolve(undefined);
              }, 10); // Fast for tests
            });
          }
          return Promise.resolve();
        }
      }),
      playing: () => true,
      stop: () => {}
    };
  }
}

class MockNodeCollection {
  constructor(private nodes: MockNode[]) {}

  forEach(callback: (node: any) => void): void {
    this.nodes.forEach(callback);
  }
}

// Mock WorkspaceMode behavior for integration testing
class MockWorkspaceMode {
  private breathingAnimationManager: BreathingAnimationManager;
  private previousLastNode: NodeSingular | null = null;

  constructor() {
    this.breathingAnimationManager = new BreathingAnimationManager();
  }

  // Simulate the newNodesAdded event handler logic
  handleNewNodesAdded(newNodes: NodeSingular[]): void {
    console.log('[Test] Handling breathing animation for newly added nodes:', newNodes.length);

    // Step 1: Give previous last node a 10s timeout (if exists)
    if (this.previousLastNode && this.breathingAnimationManager.isAnimationActive(this.previousLastNode)) {
      console.log('[Test] Adding timeout to previous last node:', this.previousLastNode.id());
      this.breathingAnimationManager.addTimeoutToExistingAnimation(this.previousLastNode, 1000); // 1s for tests
    }

    // Step 2: Add new node with persistent animation (no timeout)
    const lastNewNode = newNodes[newNodes.length - 1];

    // Simulate styling wait - in real code this would be waitForNodeStyling()
    setTimeout(() => {
      if (!this.breathingAnimationManager.isAnimationActive(lastNewNode)) {
        console.log('[Test] Adding persistent breathing animation for new last node:', lastNewNode.id());
        const collection = new MockNodeCollection([lastNewNode as any]);
        this.breathingAnimationManager.addBreathingAnimation(collection as any, AnimationType.NEW_NODE);
      }
    }, 50); // Simulate styling delay

    // Step 3: Update tracking
    this.previousLastNode = lastNewNode;
  }

  getAnimationManager(): BreathingAnimationManager {
    return this.breathingAnimationManager;
  }

  destroy(): void {
    this.breathingAnimationManager.destroy();
  }
}

describe('NewNode Animation Integration Test', () => {
  let mockWorkspace: MockWorkspaceMode;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    mockWorkspace = new MockWorkspaceMode();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    consoleSpy.mockRestore();
    mockWorkspace.destroy();
  });

  test('single new node gets persistent animation', async () => {
    const node1 = new MockNode('node-1');

    mockWorkspace.handleNewNodesAdded([node1 as any]);

    // Wait for styling delay
    jest.advanceTimersByTime(100);

    // Node should have persistent animation (no timeout)
    expect(mockWorkspace.getAnimationManager().isAnimationActive(node1 as any)).toBe(true);
    expect(node1.data('animationType')).toBe(AnimationType.NEW_NODE);

    // Should NOT timeout after long period
    jest.advanceTimersByTime(5000);
    expect(mockWorkspace.getAnimationManager().isAnimationActive(node1 as any)).toBe(true);
  });

  test('second node causes first to get timeout, second stays persistent', async () => {
    const node1 = new MockNode('node-1');
    const node2 = new MockNode('node-2');

    // Add first node
    mockWorkspace.handleNewNodesAdded([node1 as any]);
    jest.advanceTimersByTime(100);

    expect(mockWorkspace.getAnimationManager().isAnimationActive(node1 as any)).toBe(true);

    // Add second node
    mockWorkspace.handleNewNodesAdded([node2 as any]);
    jest.advanceTimersByTime(100);

    // Both should be active initially
    expect(mockWorkspace.getAnimationManager().isAnimationActive(node1 as any)).toBe(true);
    expect(mockWorkspace.getAnimationManager().isAnimationActive(node2 as any)).toBe(true);

    // After timeout period, node1 should stop, node2 should continue
    jest.advanceTimersByTime(1100); // 1s timeout + buffer

    expect(mockWorkspace.getAnimationManager().isAnimationActive(node1 as any)).toBe(false);
    expect(mockWorkspace.getAnimationManager().isAnimationActive(node2 as any)).toBe(true);
  });

  test('three nodes: only latest stays persistent', async () => {
    const node1 = new MockNode('node-1');
    const node2 = new MockNode('node-2');
    const node3 = new MockNode('node-3');

    // Add nodes sequentially
    mockWorkspace.handleNewNodesAdded([node1 as any]);
    jest.advanceTimersByTime(100);

    mockWorkspace.handleNewNodesAdded([node2 as any]);
    jest.advanceTimersByTime(100);

    mockWorkspace.handleNewNodesAdded([node3 as any]);
    jest.advanceTimersByTime(100);

    // All should be active initially
    expect(mockWorkspace.getAnimationManager().isAnimationActive(node1 as any)).toBe(false); // Already timed out
    expect(mockWorkspace.getAnimationManager().isAnimationActive(node2 as any)).toBe(true); // Got timeout when node3 added
    expect(mockWorkspace.getAnimationManager().isAnimationActive(node3 as any)).toBe(true); // Latest, persistent

    // After timeout period, only node3 should remain
    jest.advanceTimersByTime(1100);

    expect(mockWorkspace.getAnimationManager().isAnimationActive(node1 as any)).toBe(false);
    expect(mockWorkspace.getAnimationManager().isAnimationActive(node2 as any)).toBe(false);
    expect(mockWorkspace.getAnimationManager().isAnimationActive(node3 as any)).toBe(true); // Still persistent
  });

  test('multiple nodes added at once: only last gets persistent animation', async () => {
    const node1 = new MockNode('node-1');
    const node2 = new MockNode('node-2');
    const node3 = new MockNode('node-3');

    // Add multiple nodes in single event
    mockWorkspace.handleNewNodesAdded([node1 as any, node2 as any, node3 as any]);
    jest.advanceTimersByTime(100);

    // Only the last node (node3) should get animation
    expect(mockWorkspace.getAnimationManager().isAnimationActive(node1 as any)).toBe(false);
    expect(mockWorkspace.getAnimationManager().isAnimationActive(node2 as any)).toBe(false);
    expect(mockWorkspace.getAnimationManager().isAnimationActive(node3 as any)).toBe(true);

    // node3 should remain persistent
    jest.advanceTimersByTime(5000);
    expect(mockWorkspace.getAnimationManager().isAnimationActive(node3 as any)).toBe(true);
  });

  test('console logging shows correct animation lifecycle', async () => {
    const node1 = new MockNode('node-1');
    const node2 = new MockNode('node-2');

    mockWorkspace.handleNewNodesAdded([node1 as any]);
    jest.advanceTimersByTime(100);

    mockWorkspace.handleNewNodesAdded([node2 as any]);
    jest.advanceTimersByTime(100);

    // Check expected log messages
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Adding timeout to previous last node: node-1')
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Adding persistent breathing animation for new last node: node-2')
    );
  });
});