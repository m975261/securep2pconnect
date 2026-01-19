#!/bin/bash
set -e

echo "=== SECURE.LINK Update Script ==="

# Variables
INSTALL_DIR="/opt/securelink"
SERVICE_USER="webrtcapp"
SERVICE_NAME="secure-webrtc-app"

# Check if installation exists
if [ ! -d "$INSTALL_DIR" ]; then
    echo "Error: Installation not found at $INSTALL_DIR"
    echo "Run install.sh first"
    exit 1
fi

cd "$INSTALL_DIR"

echo "[1/4] Pulling latest code from GitHub..."
sudo -u "$SERVICE_USER" git pull origin main

echo "[2/4] Installing dependencies..."
sudo -u "$SERVICE_USER" npm install

echo "[3/4] Building application..."
sudo -u "$SERVICE_USER" npm run build

echo "[4/4] Restarting service..."
sudo systemctl restart "$SERVICE_NAME"

echo ""
echo "=== Update Complete ==="
sudo systemctl status "$SERVICE_NAME" --no-pager -l
