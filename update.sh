#!/bin/bash

set -e

echo "=========================================="
echo "  SECURE.LINK Update Script"
echo "=========================================="
echo ""

APP_DIR="/opt/securelink"

if [ ! -d "$APP_DIR" ]; then
    echo "Error: Application not found at $APP_DIR"
    echo "Please run the initial deployment first."
    exit 1
fi

cd "$APP_DIR"

echo "[1/4] Pulling latest code from GitHub..."
git pull origin main

echo ""
echo "[2/4] Installing dependencies..."
npm install --production

echo ""
echo "[3/4] Building application..."
npm run build

echo ""
echo "[4/4] Restarting service..."
sudo systemctl restart securelink

echo ""
echo "=========================================="
echo "  Update complete!"
echo "=========================================="
echo ""
echo "Service status:"
sudo systemctl status securelink --no-pager -l | head -15
