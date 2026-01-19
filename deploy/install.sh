#!/bin/bash
set -e

echo "=== SECURE.LINK Installation Script ==="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (sudo ./install.sh)"
    exit 1
fi

# Variables
INSTALL_DIR="/opt/securelink"
SERVICE_USER="webrtcapp"
SERVICE_NAME="secure-webrtc-app"

echo "[1/7] Creating service user..."
if ! id "$SERVICE_USER" &>/dev/null; then
    useradd --system --no-create-home --shell /bin/false "$SERVICE_USER"
    echo "Created user: $SERVICE_USER"
else
    echo "User $SERVICE_USER already exists"
fi

echo "[2/7] Creating installation directory..."
mkdir -p "$INSTALL_DIR"

echo "[3/7] Cloning repository..."
if [ -d "$INSTALL_DIR/.git" ]; then
    echo "Repository already exists, pulling latest..."
    cd "$INSTALL_DIR"
    sudo -u "$SERVICE_USER" git pull origin main
else
    git clone https://github.com/m975261/securep2pconnect.git "$INSTALL_DIR"
fi

echo "[4/7] Setting up environment file..."
if [ ! -f "$INSTALL_DIR/.env.production" ]; then
    cp "$INSTALL_DIR/deploy/.env.template" "$INSTALL_DIR/.env.production"
    
    # Generate encryption key
    ENCRYPTION_KEY=$(openssl rand -hex 32)
    sed -i "s/^TURN_ENCRYPTION_KEY=$/TURN_ENCRYPTION_KEY=$ENCRYPTION_KEY/" "$INSTALL_DIR/.env.production"
    
    echo ""
    echo "!!! IMPORTANT !!!"
    echo "Edit $INSTALL_DIR/.env.production and set your database credentials"
    echo "Generated TURN_ENCRYPTION_KEY: $ENCRYPTION_KEY"
    echo ""
fi

echo "[5/7] Setting ownership..."
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

echo "[6/7] Installing dependencies and building..."
cd "$INSTALL_DIR"
sudo -u "$SERVICE_USER" npm install
sudo -u "$SERVICE_USER" npm run build

echo "[7/7] Installing systemd service..."
cp "$INSTALL_DIR/deploy/secure-webrtc-app.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo ""
echo "=== Installation Complete ==="
echo ""
echo "Next steps:"
echo "1. Edit /opt/securelink/.env.production with your database credentials"
echo "2. Start the service: sudo systemctl start $SERVICE_NAME"
echo "3. Check status: sudo systemctl status $SERVICE_NAME"
echo "4. View logs: sudo journalctl -u $SERVICE_NAME -f"
echo ""
