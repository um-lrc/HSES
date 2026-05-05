#!/bin/bash

# Clear terminal
printf "\033c"

echo "============================================================"
echo "  Building for local/offline usage"
echo "============================================================"
echo ""

if [ ! -d "node_modules" ]; then
    echo "[INFO] node_modules not found. Installing dependencies..."
    npm install
fi

echo "[INFO] Building the application..."
npm run build

echo ""
echo "[SUCCESS] Build complete!"
echo "[INFO] You can find the output in the 'dist' folder."
echo "[INFO] Note: Some browser features may require a local server to work correctly."
echo ""
