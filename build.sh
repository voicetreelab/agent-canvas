#!/bin/bash

# Get current directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# File to edit
MAIN_FILE="$DIR/src/main.ts"

# Get current version number or start at 1
if grep -q "Loading Juggl - FIXED VERSION v" "$MAIN_FILE"; then
    # Extract current version number
    CURRENT_VERSION=$(grep "Loading Juggl - FIXED VERSION v" "$MAIN_FILE" | sed 's/.*v\([0-9]*\).*/\1/')
    NEW_VERSION=$((CURRENT_VERSION + 1))
    # Replace the version
    sed -i '' "s/Loading Juggl - FIXED VERSION v[0-9]*/Loading Juggl - FIXED VERSION v$NEW_VERSION/" "$MAIN_FILE"
else
    # Add the version line if it doesn't exist
    sed -i '' "s/Loading Juggl/Loading Juggl - FIXED VERSION v1/" "$MAIN_FILE"
    NEW_VERSION=1
fi

echo "Updated version to v$NEW_VERSION"

# Run build
echo "Building..."
npm run build

# Copy files to vault
echo "Copying files to vault..."
cp main.js manifest.json styles.css ../repos/VoiceTree/markdownTreeVault/.obsidian/plugins/juggl/
cp main.js manifest.json styles.css ../repos/VoiceTree/backend/benchmarker/output/.obsidian/plugins/juggl
cp main.js manifest.json styles.css ../repos/VoiceTree/backend/benchmarker/output/voiceTree_clustering/.obsidian/plugins/juggl

echo "Build and deploy complete - FIXED VERSION v$NEW_VERSION"