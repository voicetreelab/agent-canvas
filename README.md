# VoiceTree UI

A graph-based visualization interface for VoiceTree that enables interactive canvas environments for terminal and coding agents.

## Features

- **Agent Node Canvas**: Visual representation of terminal and coding agents as interactive nodes on a graph
- **Automatic Node Positioning**: Intelligent placement of new nodes created by you or your agents
- **Interactive Graph Visualization**: Built on Cytoscape.js and juggl-ui for powerful graph manipulation

## Installation

Requires Obsidian with Terminal plugin already installed.

```bash
cd juggl-main
./build.sh
```

## Architecture

Built on the Juggl plugin framework, VoiceTree UI extends graph visualization capabilities with:
- Custom data stores for agent nodes
- Event handlers for agent lifecycle management  
- Extended node types for terminal and code content
- Intelligent positioning algorithms for new nodes

## License

See LICENSE file for details.