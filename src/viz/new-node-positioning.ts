import {
  NodeCollection,
  NodeDefinition,
  ElementDefinition,
  Core,
} from 'cytoscape';
import {
  CLASSES,
} from '../constants';

// Define IMergedToGraph interface locally since it's missing from juggl-api
interface IMergedToGraph {
  merged: NodeCollection;
  added: NodeCollection;
}

export function findOptimalPosition(parentNode: any, newNode: any): {x: number, y: number} {
  const parentPos = parentNode.position();
  const parentEdges = parentNode.connectedEdges();
  
  console.log(`[Juggl Position Debug] Placing node near parent ${parentNode.id()}`);
  console.log(`[Juggl Position Debug] - Parent has ${parentEdges.length} edges`);
  
  // Get angles of existing edges from parent
  const occupiedAngles: number[] = [];
  parentEdges.forEach(edge => {
    const otherNode = edge.source().id() === parentNode.id() ? edge.target() : edge.source();
    const otherPos = otherNode.position();
    
    const angle = Math.atan2(otherPos.y - parentPos.y, otherPos.x - parentPos.x);
    occupiedAngles.push(angle);
  });
  
  // Find the best angle (furthest from all existing edges)
  let bestAngle = 0;
  let maxMinDistance = -Infinity;
  
  // Try 8 different angles
  for (let i = 0; i < 8; i++) {
    const candidateAngle = (i / 8) * 2 * Math.PI;
    
    // Find minimum distance to any occupied angle
    let minDistance = Infinity;
    occupiedAngles.forEach(occupiedAngle => {
      const angleDiff = Math.abs(candidateAngle - occupiedAngle);
      const distance = Math.min(angleDiff, 2 * Math.PI - angleDiff);
      minDistance = Math.min(minDistance, distance);
    });
    
    if (minDistance > maxMinDistance) {
      maxMinDistance = minDistance;
      bestAngle = candidateAngle;
    }
  }
  
  // Place node at the best angle, 93 units away
  const distance = 143;
  const position = {
    x: parentPos.x + Math.cos(bestAngle) * distance,
    y: parentPos.y + Math.sin(bestAngle) * distance
  };
  
  console.log(`[Juggl Position Debug] - Placing at angle ${(bestAngle * 180 / Math.PI).toFixed(0)}°, distance ${distance}`);
  
  return position;
}

// Track the last parent used for positioning
let lastParentNode: any = null;

export function setInitialNodePositions(
  viz: Core,
  newNodes: NodeCollection,
  parentNodes?: NodeCollection,
  findOptimalPositionFn: (parentNode: any, newNode: any) => {x: number, y: number} = findOptimalPosition
): void {
  newNodes.forEach((node) => {
    const existingNodes = viz.nodes().difference(newNodes);
    
    // Find parent using our simplified logic
    const potentialParents = findPotentialConnections(viz, node, existingNodes);
    
    if (potentialParents.length > 0) {
      // We have a parent - place near it
      const parent = potentialParents[0];
      const position = findOptimalPositionFn(parent, node);
      node.position(position);
      
      const parentPos = parent.position();
      const distance = Math.sqrt(
        Math.pow(position.x - parentPos.x, 2) + 
        Math.pow(position.y - parentPos.y, 2)
      );
      
      console.log(`[Juggl Position Debug] Positioned ${node.id()} at distance ${distance.toFixed(2)} from parent ${parent.id()}`);
      
      // Remember this parent for future orphan nodes
      lastParentNode = parent;
    } else {
      // No parent found - use last parent if available
      if (lastParentNode && viz.$id(lastParentNode.id()).length > 0) {
        const position = findOptimalPositionFn(lastParentNode, node);
        
        // Add randomness for orphans (up to ±93 units in each direction)
        position.x += (Math.random() - 0.5) * 2 * 123;
        position.y += (Math.random() - 0.5) * 2 * 123;
        
        node.position(position);
        console.log(`[Juggl Position Debug] Orphan ${node.id()} placed near last parent ${lastParentNode.id()} with randomness`);
      } else {
        // No last parent available - place randomly near center of mass
        const existingNodes = viz.nodes().difference(newNodes);
        let centerX = 0, centerY = 0;
        
        if (existingNodes.length > 0) {
          existingNodes.forEach(n => {
            const pos = n.position();
            centerX += pos.x;
            centerY += pos.y;
          });
          centerX /= existingNodes.length;
          centerY /= existingNodes.length;
        }
        
        node.position({ 
          x: centerX + (Math.random() - 0.5) * 186, 
          y: centerY + (Math.random() - 0.5) * 186 
        });
        console.log(`[Juggl Position Debug] Orphan ${node.id()} placed randomly near center of mass (${centerX.toFixed(0)}, ${centerY.toFixed(0)})`);
      }
    }
  });
}

function findPotentialConnections(viz: Core, newNode: any, existingNodes: any): any[] {
  const newNodeId = newNode.id();
  const linkedNodeIds = newNode.data('linkedNodeIds');
  
  console.log(`[Juggl Position Debug] Finding parent for ${newNodeId}`);
  console.log(`[Juggl Position Debug] - linkedNodeIds:`, linkedNodeIds);
  
  // ONLY use linkedNodeIds - no fallbacks, no heuristics
  if (linkedNodeIds && Array.isArray(linkedNodeIds) && linkedNodeIds.length > 0) {
    // Just use the first link as the parent
    const parentId = linkedNodeIds[0];
    const parentNode = viz.$id(parentId);
    
    if (parentNode.length > 0) {
      console.log(`[Juggl Position Debug] Found parent node: ${parentId}`);
      return [parentNode[0]];
    }
  }
  
  console.log(`[Juggl Position Debug] No parent found for ${newNodeId}`);
  return [];
}

export function mergeToGraph(
  viz: Core,
  elements: ElementDefinition[],
  batch: boolean = true,
  triggerGraphChanged: boolean = true,
  parentNodes?: NodeCollection,
  nodeCache?: any,
  onGraphChanged?: (batch: boolean) => void,
  setInitialNodePositionsFn: (
    viz: Core,
    newNodes: NodeCollection,
    parentNodes?: NodeCollection
  ) => void = setInitialNodePositions
): IMergedToGraph {
  if (batch) {
    viz.startBatch();
  }
  const addElements: ElementDefinition[] = [];
  const mergedCollection = viz.collection();
  elements.forEach((n) => {
    if (viz.$id(n.data.id).length === 0) {
      addElements.push(n);
    } else {
      const gElement = viz.$id(n.data.id);
      const extraClasses = CLASSES.filter((clazz) => gElement.hasClass(clazz));

      // @ts-ignore
      extraClasses.push(...gElement.classes().filter((el: string) => el.startsWith('global-') || el.startsWith('local-')));

      // TODO: Maybe make an event here
      gElement.classes(n.classes);
      for (const clazz of extraClasses) {
        gElement.addClass(clazz);
      }
      gElement.data(n.data);
      mergedCollection.merge(gElement);
    }
  });
  // console.log('[Juggl Position Debug] mergeToGraph - adding elements:', addElements.length);
  if (addElements.length > 0) {
    const nodeElements = addElements.filter(el => el.group === 'nodes');
    const edgeElements = addElements.filter(el => el.group === 'edges');
    // console.log(`[Juggl Position Debug] - ${nodeElements.length} nodes, ${edgeElements.length} edges`);
  }
  
  const addCollection = viz.add(addElements);
  
  // Set initial positions for new nodes after adding them
  const newNodes = addCollection.nodes();
  // console.log(`[Juggl Position Debug] addCollection has ${addCollection.length} elements, ${newNodes.length} nodes`);
  
  if (newNodes.length > 0) {
    setInitialNodePositionsFn(viz, newNodes, parentNodes);
    
    // Store initial positions for comparison after layout
    const initialPositions = new Map();
    newNodes.forEach((node) => {
      initialPositions.set(node.id(), node.position());
    });
    
    // Set up one-time listener for layout stop to measure position changes
    if (triggerGraphChanged) {
      viz.one('layoutstop', () => {
        console.log('[Juggl Position Debug] Layout completed, checking position changes:');
        newNodes.forEach((node) => {
          const initial = initialPositions.get(node.id());
          const final = node.position();
          const distance = Math.sqrt(
            Math.pow(final.x - initial.x, 2) + 
            Math.pow(final.y - initial.y, 2)
          );
          console.log(`[Juggl Position Debug] - ${node.id()} moved ${distance.toFixed(2)} units`);
          if (distance > 50) {
            console.log(`[Juggl Position Debug]   WARNING: Large movement detected!`);
            console.log(`[Juggl Position Debug]   - Initial:`, initial);
            console.log(`[Juggl Position Debug]   - Final:`, final);
          }
        });
      });
    }
  }
  
  mergedCollection.merge(addCollection);
  if (triggerGraphChanged && onGraphChanged) {
    console.log('[Juggl Position Debug] mergeToGraph - triggering onGraphChanged');
    onGraphChanged(false);
  }
  if (batch) {
    viz.endBatch();
  }
  return {merged: mergedCollection, added: addCollection};
}