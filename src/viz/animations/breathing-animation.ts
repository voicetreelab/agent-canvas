import type { NodeCollection, NodeSingular } from 'cytoscape';
import { CLASS_PINNED } from '../../constants';

export enum AnimationType {
  PINNED = 'pinned',
  NEW_NODE = 'new_node',
  APPENDED_CONTENT = 'appended_content'
}

export interface BreathingAnimationConfig {
  duration?: number;
  timeout?: number;
  expandWidth?: number;
  expandColor?: string;
  expandOpacity?: number;
  contractColor?: string;
  contractOpacity?: number;
  type?: AnimationType;
}

export class BreathingAnimationManager {
  private breathingAnimations: Map<string, any> = new Map();
  private breathingTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private defaultConfigs: Map<AnimationType, Required<BreathingAnimationConfig>>;

  constructor() {
    // Set up different configurations for each animation type


    this.defaultConfigs = new Map([
      [AnimationType.PINNED, {
        duration: 800,
        timeout: 0, // No timeout for pinned nodes
        expandWidth: 4,
        expandColor: 'rgba(255, 165, 0, 0.9)', // Orange for pinned nodes
        expandOpacity: 0.8,
        contractColor: 'rgba(255, 165, 0, 0.4)',
        contractOpacity: 0.6,
        type: AnimationType.PINNED
      }],
      [AnimationType.NEW_NODE, {
        duration: 1000,
        timeout: 0, // No timeout by default - timeout added later via addTimeoutToExistingAnimation
        expandWidth: 4,
        expandColor: 'rgba(0, 255, 0, 0.9)', // Green for new nodes
        expandOpacity: 0.8,
        contractColor: 'rgba(0, 255, 0, 0.5)',
        contractOpacity: 0.7,
        type: AnimationType.NEW_NODE
      }],
      [AnimationType.APPENDED_CONTENT, {
        duration: 1200,
        timeout: 15000,
        expandWidth: 4,
        expandColor: 'rgba(0, 255, 255, 0.9)',
        expandOpacity: 0.8,
        contractColor: 'rgba(0, 255, 255, 0.6)',
        contractOpacity: 0.7,
        type: AnimationType.APPENDED_CONTENT
      }]
    ]);
  }

  private getConfig(type: AnimationType): Required<BreathingAnimationConfig> {
    return this.defaultConfigs.get(type) || this.defaultConfigs.get(AnimationType.PINNED)!;
  }

  public addBreathingAnimation(nodes: NodeCollection, type: AnimationType = AnimationType.PINNED): void {
    const config = this.getConfig(type);
    
    nodes.forEach((node) => {
      const nodeId = node.id();
      
      // Stop any existing animation for this node
      this.stopAnimation(nodeId);

      // Log current style state for debugging
      console.log(`[Juggl] Initializing breathing animation for node ${nodeId}, type: ${type}`);
      console.log(`[Juggl] Current border-width: ${node.style('border-width')}, border-color: ${node.style('border-color')}`);

      // Capture the actual current border values before animation
      const currentBorderWidth = node.style('border-width');
      const currentBorderColor = node.style('border-color');
      
      // For most nodes, the default is no border (border-width: 0)
      // We should restore to this state after animation unless the node has a specific border
      let originalBorderWidth = '0'; // Default to no border
      let originalBorderColor = 'rgba(0, 0, 0, 0)'; // Transparent
      
      // Only preserve border if it's explicitly set and visible
      if (currentBorderWidth && currentBorderWidth !== '0px' && currentBorderWidth !== '0') {
        // Check if this is a temporary animation color (green, orange, cyan)
        const isAnimationColor = currentBorderColor && (
          currentBorderColor.includes('0, 255, 0') || // Green (new nodes)
          currentBorderColor.includes('255, 165, 0') || // Orange (appended)
          currentBorderColor.includes('0, 255, 255') // Cyan (pinned)
        );
        
        if (!isAnimationColor) {
          // Only preserve non-animation colors
          originalBorderWidth = currentBorderWidth;
          originalBorderColor = currentBorderColor;
        }
      }
      
      // Store the actual original values
      node.data('originalBorderWidth', originalBorderWidth);
      node.data('originalBorderColor', originalBorderColor);
      node.data('breathingActive', true);
      node.data('animationType', type);
      
      // Set initial border style if node has no border
      if (!currentBorderWidth || currentBorderWidth === '0px' || currentBorderWidth === '0') {
        console.log(`[Juggl] Setting initial border for node ${nodeId} to enable animation`);
        node.style({
          'border-width': originalBorderWidth,
          'border-color': originalBorderColor,
          'border-style': 'solid',
          'border-opacity': 1
        });
      }
      
      // Create the breathing animation loop
      this.createBreathingLoop(node, config);
      
      // Set timeout to stop the animation (only if timeout > 0)
      if (config.timeout > 0) {
        console.log(`[Juggl] Setting timeout for ${type} animation on node ${nodeId}: ${config.timeout}ms`);
        // Capture necessary data in closure
        const capturedNodeId = nodeId;
        const cy = node.cy();
        
        const timeout = setTimeout(() => {
          console.log(`[Juggl] Timeout fired! Stopping ${type} breathing animation for node ${capturedNodeId} after ${config.timeout}ms`);
          // Find the node by ID and stop animation
          const currentNode = cy.getElementById(capturedNodeId);
          if (currentNode && currentNode.length > 0) {
            this.stopAnimationForNode(currentNode);
          } else {
            console.log(`[Juggl] Warning: Node ${capturedNodeId} not found when timeout fired`);
            // Still clean up the animation data
            this.stopAnimation(capturedNodeId);
          }
        }, config.timeout);
        
        this.breathingTimeouts.set(nodeId, timeout);
        console.log(`[Juggl] Timeout stored for node ${nodeId}, timeout ID:`, timeout);
      } else {
        console.log(`[Juggl] No timeout set for ${type} animation on node ${nodeId} (timeout: ${config.timeout})`);
      }
    });
  }

  private createBreathingLoop(node: NodeSingular, config: Required<BreathingAnimationConfig>): void {
    const nodeId = node.id();
    if (!node.data('breathingActive')) {
      console.log(`[Juggl] Breathing loop stopped for node ${nodeId} - breathingActive is false`);
      this.breathingAnimations.delete(nodeId);
      return;
    }

    // Create forward animation (expand)
    const expandAnimation = node.animation({
      style: {
        'border-width': config.expandWidth,
        'border-color': config.expandColor,
        'border-opacity': config.expandOpacity
      },
      duration: config.duration,
      easing: 'ease-in-out-sine'
    });

    // Store reference
    this.breathingAnimations.set(node.id(), expandAnimation);

    // Play expand animation
    expandAnimation
      .play()
      .promise('completed')
      .then(() => {
        if (!node.data('breathingActive')) {
          this.breathingAnimations.delete(node.id());
          return;
        }

        // Create contract animation
        const contractAnimation = node.animation({
          style: {
            'border-width': node.data('originalBorderWidth') || '2',
            'border-color': config.contractColor,
            'border-opacity': config.contractOpacity
          },
          duration: config.duration,
          easing: 'ease-in-out-sine'
        });

        // Update reference
        this.breathingAnimations.set(node.id(), contractAnimation);

        return contractAnimation.play().promise('completed');
      })
      .then(() => {
        // Continue the loop
        if (node.data('breathingActive')) {
          this.createBreathingLoop(node, config);
        } else {
          this.breathingAnimations.delete(node.id());
        }
      })
      .catch(() => {
        // Clean up on error
        this.breathingAnimations.delete(node.id());
      });
  }

  public stopAnimation(nodeId: string): void {
    console.log(`[Juggl] stopAnimation called for node ${nodeId}`);
    // Clear timeout
    const timeout = this.breathingTimeouts.get(nodeId);
    if (timeout) {
      console.log(`[Juggl] Clearing timeout for node ${nodeId}`);
      clearTimeout(timeout);
      this.breathingTimeouts.delete(nodeId);
    }
    
    // Stop animation
    const animation = this.breathingAnimations.get(nodeId);
    if (animation && animation.playing()) {
      animation.stop();
    }
    this.breathingAnimations.delete(nodeId);
  }

  public stopAnimationForNode(node: NodeSingular): void {
    const nodeId = node.id();
    
    // Mark as inactive
    node.data('breathingActive', false);
    
    // Stop animation
    this.stopAnimation(nodeId);
    
    // Restore original style
    const originalBorderWidth = node.data('originalBorderWidth') || '0';
    const originalBorderColor = node.data('originalBorderColor') || 'rgba(0, 0, 0, 0)';
    const originalBorderOpacity = node.data('originalBorderOpacity') || '0';
    
    node.style({
      'border-width': originalBorderWidth,
      'border-color': originalBorderColor,
      'border-opacity': originalBorderOpacity
    });
    
    console.log(`[Juggl] Stopped breathing animation for node ${nodeId}`);
  }

  public addTimeoutToExistingAnimation(node: NodeSingular, timeout: number): void {
    const nodeId = node.id();

    if (!this.isAnimationActive(node)) {
      return;
    }

    console.log(`[Juggl] Adding ${timeout}ms timeout to existing animation for node ${nodeId}`);

    // Set timeout to stop animation
    const cy = node.cy();
    const capturedNodeId = nodeId;

    const newTimeout = setTimeout(() => {
      console.log(`[Juggl] Timeout fired! Stopping animation for node ${capturedNodeId} after ${timeout}ms`);
      const currentNode = cy.getElementById(capturedNodeId);
      if (currentNode && currentNode.length > 0) {
        this.stopAnimationForNode(currentNode);
      } else {
        this.stopAnimation(capturedNodeId);
      }
    }, timeout);

    this.breathingTimeouts.set(nodeId, newTimeout);
  }

  public stopAllAnimations(nodes: NodeCollection): void {
    nodes.forEach((node) => {
      this.stopAnimationForNode(node);

      // Clean up data
      node.removeData('breathingActive originalBorderWidth originalBorderColor originalBorderOpacity');
    });
  }

  public isAnimationActive(node: NodeSingular): boolean {
    return node.data('breathingActive') === true;
  }

  public destroy(): void {
    // Clear all timeouts
    this.breathingTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.breathingTimeouts.clear();

    // Stop all animations
    this.breathingAnimations.forEach((animation) => {
      if (animation && animation.playing()) {
        animation.stop();
      }
    });
    this.breathingAnimations.clear();
  }
}