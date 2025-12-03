#!/usr/bin/env bash
#
# SECURE.LINK WebRTC App - Ubuntu Deployment Script
# 
# Usage: sudo ./deploy_ubuntu.sh /path/to/project.zip
#
# This script will:
# 1. Install Node.js 20 and PostgreSQL
# 2. Create database and user
# 3. Extract and build the project
# 4. Set up systemd service for auto-start
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if running as root
if [[ $EUID -ne 0 ]]; then
  log_error "Please run as root (e.g., sudo $0 /path/to/project.zip)"
  exit 1
fi

# Check for zip file argument
ZIP_PATH="${1:-}"
if [[ -z "$ZIP_PATH" ]]; then
  echo "=========================================="
  echo "  SECURE.LINK Ubuntu Deployment Script"
  echo "=========================================="
  echo ""
  echo "Usage: sudo $0 /absolute/path/to/project.zip"
  echo ""
  echo "This script will install and configure:"
  echo "  - Node.js 20.x"
  echo "  - PostgreSQL database"
  echo "  - Build and deploy the application"
  echo "  - Set up systemd service"
  echo ""
  exit 1
fi

if [[ ! -f "$ZIP_PATH" ]]; then
  log_error "Zip file not found: $ZIP_PATH"
  exit 1
fi

# Configuration
APP_NAME="secure-webrtc-app"
APP_DIR="/opt/${APP_NAME}"
APP_USER="webrtcapp"
DB_NAME="webrtc_app_db"
DB_USER="webrtc_app_user"
DB_PASSWORD="$(openssl rand -base64 24 | tr -d "'\n")"
SESSION_SECRET="$(openssl rand -hex 32)"
ENCRYPTION_KEY="$(openssl rand -hex 32)"
PORT="${PORT:-5000}"
NODE_VERSION_MAJOR=20

echo ""
echo "=========================================="
echo "  Starting Deployment"
echo "=========================================="
echo ""
log_info "App Name: $APP_NAME"
log_info "Install Dir: $APP_DIR"
log_info "Port: $PORT"
echo ""

# Step 1: Install system dependencies
log_info "Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq curl unzip ca-certificates build-essential gnupg postgresql postgresql-contrib openssl rsync

# Step 2: Install Node.js 20
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d'.' -f1 | tr -d 'v')" -ne "$NODE_VERSION_MAJOR" ]]; then
  log_info "Installing Node.js ${NODE_VERSION_MAJOR}.x..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
else
  log_info "Node.js $(node -v) already installed"
fi

# Step 3: Configure PostgreSQL
log_info "Configuring PostgreSQL..."
systemctl enable postgresql
systemctl start postgresql

# Create app user if not exists
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  log_info "Creating system user: $APP_USER"
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

# Create database user if not exists
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  log_info "Creating database user: $DB_USER"
  sudo -u postgres psql -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';"
fi

# Create database if not exists
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  log_info "Creating database: $DB_NAME"
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
fi

# Step 4: Extract project files
log_info "Extracting project files..."
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

unzip -q "$ZIP_PATH" -d "$TEMP_DIR"

# Handle nested directory in zip
SRC_DIR="$TEMP_DIR"
if [[ $(find "$TEMP_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l) -eq 1 ]]; then
  SRC_DIR="$(find "$TEMP_DIR" -mindepth 1 -maxdepth 1 -type d)"
fi

# Remove old installation and copy new files
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
rsync -a "$SRC_DIR"/ "$APP_DIR"/

# Step 5: Build the application
log_info "Building application..."
cd "$APP_DIR"

export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}"

# Install dependencies
log_info "Installing npm dependencies..."
npm ci --silent

# Run database migrations
log_info "Running database migrations..."
npx drizzle-kit push

# Build production assets
log_info "Building production assets..."
npm run build

# Step 6: Create environment file
log_info "Creating environment configuration..."
cat > .env.production <<EOF
NODE_ENV=production
PORT=${PORT}
DATABASE_URL=${DATABASE_URL}
SESSION_SECRET=${SESSION_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
EOF

# Set ownership
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# Step 7: Create systemd service
log_info "Creating systemd service..."
cat > /etc/systemd/system/${APP_NAME}.service <<EOF
[Unit]
Description=Secure WebRTC Application (SECURE.LINK)
After=network.target postgresql.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env.production
ExecStart=/usr/bin/node ${APP_DIR}/dist/index.js
Restart=on-failure
RestartSec=5
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=${APP_NAME}

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
systemctl daemon-reload
systemctl enable --now ${APP_NAME}.service

# Wait a moment for service to start
sleep 2

echo ""
echo "=========================================="
echo "  Deployment Complete!"
echo "=========================================="
echo ""
log_info "Application is running on port ${PORT}"
echo ""
echo "Useful commands:"
echo "  - Check status:  sudo systemctl status ${APP_NAME}"
echo "  - View logs:     sudo journalctl -u ${APP_NAME} -f"
echo "  - Restart:       sudo systemctl restart ${APP_NAME}"
echo "  - Stop:          sudo systemctl stop ${APP_NAME}"
echo ""
echo "Configuration:"
echo "  - App directory: ${APP_DIR}"
echo "  - Config file:   ${APP_DIR}/.env.production"
echo "  - Database:      ${DB_NAME}"
echo ""
log_warn "Save these credentials securely:"
echo "  DATABASE_URL=${DATABASE_URL}"
echo ""
echo "Access the app at: http://YOUR_SERVER_IP:${PORT}"
echo ""

# Show service status
systemctl status ${APP_NAME} --no-pager || true
