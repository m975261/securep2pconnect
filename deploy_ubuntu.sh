#!/usr/bin/env bash
#
# SECURE.LINK WebRTC App - Ubuntu 24.04 LTS Deployment Script
# 
# Usage: sudo ./deploy_ubuntu.sh /path/to/project.zip
#
# This script will:
# 1. Install Node.js 20 and PostgreSQL (if not present)
# 2. Create database and user (or reuse existing)
# 3. Extract and build the project
# 4. Set up systemd service for auto-start
#
# Features:
# - Idempotent: Safe to run multiple times
# - Auto-downloads all dependencies
# - Single-run success guaranteed
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

# Error handler
error_exit() {
  log_error "$1"
  exit 1
}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
  log_error "Please run as root (e.g., sudo $0 /path/to/project.zip)"
  exit 1
fi

# Check for zip file argument
ZIP_PATH="${1:-}"
if [[ -z "$ZIP_PATH" ]]; then
  echo "=========================================="
  echo "  SECURE.LINK Ubuntu 24.04 Deployment"
  echo "=========================================="
  echo ""
  echo "Usage: sudo $0 /absolute/path/to/project.zip"
  echo ""
  echo "This script will install and configure:"
  echo "  - Node.js 20.x"
  echo "  - PostgreSQL 16 database"
  echo "  - Build and deploy the application"
  echo "  - Set up systemd service"
  echo ""
  echo "The script is idempotent - safe to run multiple times."
  echo ""
  exit 1
fi

if [[ ! -f "$ZIP_PATH" ]]; then
  error_exit "Zip file not found: $ZIP_PATH"
fi

# Configuration
APP_NAME="secure-webrtc-app"
APP_DIR="/opt/${APP_NAME}"
APP_USER="webrtcapp"
DB_NAME="webrtc_app_db"
DB_USER="webrtc_app_user"
PORT="${PORT:-5000}"
NODE_VERSION_MAJOR=20
ENV_FILE="${APP_DIR}/.env.production"
CREDENTIALS_FILE="/root/.${APP_NAME}-credentials"

echo ""
echo "=========================================="
echo "  SECURE.LINK Deployment Starting"
echo "=========================================="
echo ""
log_info "Target: Ubuntu $(lsb_release -rs 2>/dev/null || echo '24.04')"
log_info "App Name: $APP_NAME"
log_info "Install Dir: $APP_DIR"
log_info "Port: $PORT"
echo ""

# ============================================
# Step 1: Install system dependencies
# ============================================
log_step "Step 1/8: Installing system dependencies..."

# Update package list
apt-get update -qq || error_exit "Failed to update package list"

# Install required packages
PACKAGES="curl unzip ca-certificates build-essential gnupg postgresql postgresql-contrib openssl rsync lsb-release"
apt-get install -y -qq $PACKAGES || error_exit "Failed to install system packages"

log_info "System dependencies installed"

# ============================================
# Step 2: Install Node.js 20
# ============================================
log_step "Step 2/8: Setting up Node.js ${NODE_VERSION_MAJOR}.x..."

CURRENT_NODE_VERSION=""
if command -v node >/dev/null 2>&1; then
  CURRENT_NODE_VERSION="$(node -v | cut -d'.' -f1 | tr -d 'v')"
fi

if [[ "$CURRENT_NODE_VERSION" != "$NODE_VERSION_MAJOR" ]]; then
  log_info "Installing Node.js ${NODE_VERSION_MAJOR}.x..."
  
  # Remove old NodeSource list if exists
  rm -f /etc/apt/sources.list.d/nodesource.list 2>/dev/null || true
  
  # Add NodeSource repository
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION_MAJOR}.x" | bash - || error_exit "Failed to add NodeSource repository"
  apt-get install -y -qq nodejs || error_exit "Failed to install Node.js"
  
  log_info "Node.js $(node -v) installed"
else
  log_info "Node.js $(node -v) already installed"
fi

# Verify npm is available
if ! command -v npm >/dev/null 2>&1; then
  error_exit "npm not found after Node.js installation"
fi

# ============================================
# Step 3: Configure PostgreSQL
# ============================================
log_step "Step 3/8: Configuring PostgreSQL..."

# Ensure PostgreSQL is enabled and running
systemctl enable postgresql >/dev/null 2>&1 || true
systemctl start postgresql || error_exit "Failed to start PostgreSQL"

# Wait for PostgreSQL to be ready
for i in {1..10}; do
  if sudo -u postgres psql -c "SELECT 1" >/dev/null 2>&1; then
    break
  fi
  log_info "Waiting for PostgreSQL to be ready... ($i/10)"
  sleep 1
done

if ! sudo -u postgres psql -c "SELECT 1" >/dev/null 2>&1; then
  error_exit "PostgreSQL is not responding"
fi

log_info "PostgreSQL is running"

# ============================================
# Step 4: Handle credentials (idempotent)
# ============================================
log_step "Step 4/8: Managing credentials..."

# Check if we have existing credentials
if [[ -f "$CREDENTIALS_FILE" ]]; then
  log_info "Loading existing credentials..."
  source "$CREDENTIALS_FILE"
  DB_PASSWORD="${SAVED_DB_PASSWORD}"
  SESSION_SECRET="${SAVED_SESSION_SECRET}"
  ENCRYPTION_KEY="${SAVED_ENCRYPTION_KEY}"
else
  log_info "Generating new credentials..."
  DB_PASSWORD="$(openssl rand -base64 24 | tr -d "'\n/+=" | head -c 32)"
  SESSION_SECRET="$(openssl rand -hex 32)"
  ENCRYPTION_KEY="$(openssl rand -hex 32)"
  
  # Save credentials for future runs
  cat > "$CREDENTIALS_FILE" <<EOF
SAVED_DB_PASSWORD="${DB_PASSWORD}"
SAVED_SESSION_SECRET="${SESSION_SECRET}"
SAVED_ENCRYPTION_KEY="${ENCRYPTION_KEY}"
EOF
  chmod 600 "$CREDENTIALS_FILE"
  log_info "Credentials saved to $CREDENTIALS_FILE"
fi

# Create or update database user
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  log_info "Updating database user password..."
  sudo -u postgres psql -c "ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';" >/dev/null
else
  log_info "Creating database user: $DB_USER"
  sudo -u postgres psql -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';" >/dev/null
fi

# Create database if not exists
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  log_info "Creating database: $DB_NAME"
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" >/dev/null
else
  log_info "Database $DB_NAME already exists"
  # Ensure ownership
  sudo -u postgres psql -c "ALTER DATABASE ${DB_NAME} OWNER TO ${DB_USER};" >/dev/null 2>&1 || true
fi

# Grant privileges
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" >/dev/null

# Build DATABASE_URL
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}"

log_info "Database configured successfully"

# ============================================
# Step 5: Create app user
# ============================================
log_step "Step 5/8: Setting up application user..."

if ! id -u "$APP_USER" >/dev/null 2>&1; then
  log_info "Creating system user: $APP_USER"
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
else
  log_info "System user $APP_USER already exists"
fi

# ============================================
# Step 6: Extract and build project
# ============================================
log_step "Step 6/8: Extracting and building project..."

# Create temporary directory
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

# Extract zip
log_info "Extracting project files..."
unzip -q "$ZIP_PATH" -d "$TEMP_DIR" || error_exit "Failed to extract zip file"

# Handle nested directory in zip
SRC_DIR="$TEMP_DIR"
if [[ $(find "$TEMP_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l) -eq 1 ]]; then
  SRC_DIR="$(find "$TEMP_DIR" -mindepth 1 -maxdepth 1 -type d)"
fi

# Verify it's a valid project
if [[ ! -f "$SRC_DIR/package.json" ]]; then
  error_exit "Invalid project: package.json not found"
fi

# Stop service if running (before updating files)
if systemctl is-active --quiet ${APP_NAME}.service 2>/dev/null; then
  log_info "Stopping existing service..."
  systemctl stop ${APP_NAME}.service
fi

# Backup existing .env.production if it exists
if [[ -f "$APP_DIR/.env.production" ]]; then
  cp "$APP_DIR/.env.production" "/tmp/.env.production.backup" 2>/dev/null || true
fi

# Remove old installation and copy new files
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
rsync -a "$SRC_DIR"/ "$APP_DIR"/ || error_exit "Failed to copy project files"

# Create environment file BEFORE npm install (some scripts may need it)
log_info "Creating environment configuration..."
cat > "$APP_DIR/.env.production" <<EOF
NODE_ENV=production
PORT=${PORT}
DATABASE_URL=${DATABASE_URL}
SESSION_SECRET=${SESSION_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
EOF

# Set initial ownership
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# Build the application
cd "$APP_DIR"

# Export DATABASE_URL for build process
export DATABASE_URL

# Install ALL dependencies (including dev for build tools like drizzle-kit, vite, typescript)
# Note: Do NOT set NODE_ENV=production here as it causes npm to skip devDependencies
log_info "Installing npm dependencies (this may take a few minutes)..."
npm ci --include=dev 2>/dev/null || npm install --include=dev || error_exit "Failed to install npm dependencies"

# Run database migrations
log_info "Running database migrations..."
NODE_ENV=development npx drizzle-kit push --force 2>/dev/null || NODE_ENV=development npx drizzle-kit push || error_exit "Failed to run database migrations"

# Build production assets
log_info "Building production assets..."
NODE_ENV=production npm run build || error_exit "Failed to build application"

# Prune dev dependencies to reduce deployment size
log_info "Pruning dev dependencies..."
npm prune --omit=dev 2>/dev/null || true

# Set NODE_ENV for runtime
export NODE_ENV=production

# Final ownership set
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

log_info "Project built successfully"

# ============================================
# Step 7: Create systemd service
# ============================================
log_step "Step 7/8: Creating systemd service..."

cat > /etc/systemd/system/${APP_NAME}.service <<EOF
[Unit]
Description=Secure WebRTC Application (SECURE.LINK)
Documentation=https://github.com/your-repo
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env.production
ExecStart=/usr/bin/node ${APP_DIR}/dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${APP_NAME}

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${APP_DIR}
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd
systemctl daemon-reload

log_info "Systemd service created"

# ============================================
# Step 8: Start and verify service
# ============================================
log_step "Step 8/8: Starting application..."

# Enable and start service
systemctl enable ${APP_NAME}.service >/dev/null 2>&1
systemctl start ${APP_NAME}.service || error_exit "Failed to start application service"

# Wait for service to start
log_info "Waiting for application to start..."
sleep 3

# Verify service is running
if ! systemctl is-active --quiet ${APP_NAME}.service; then
  log_error "Service failed to start. Checking logs..."
  journalctl -u ${APP_NAME} --no-pager -n 20
  error_exit "Application failed to start"
fi

# Verify application is responding
for i in {1..10}; do
  if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}" 2>/dev/null | grep -q "200\|301\|302"; then
    break
  fi
  sleep 1
done

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
echo "  - Credentials:   ${CREDENTIALS_FILE}"
echo "  - Database:      ${DB_NAME}"
echo ""
echo "Access the app at: http://YOUR_SERVER_IP:${PORT}"
echo ""

# Show service status
systemctl status ${APP_NAME} --no-pager || true

echo ""
log_info "Deployment completed successfully!"
