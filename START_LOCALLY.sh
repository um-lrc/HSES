#!/bin/bash

# Clear terminal
printf "\033c"

echo "============================================================"
echo "  Practice High-Stakes Academic English Simulator"
echo "============================================================"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "[INFO] node_modules not found. Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "[ERROR] npm install failed. Please ensure Node.js is installed."
        exit 1
    fi
fi

echo "[INFO] Starting the application..."
echo "[INFO] Access the app at http://localhost:3000"
echo ""

npm run dev -- --port 3000
