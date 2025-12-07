#!/usr/bin/env bash
#
# Create deployment zip file for SECURE.LINK
# This script packages all necessary files for Ubuntu deployment
#

set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# Output file name with timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ZIP_NAME="secure-webrtc-deploy-${TIMESTAMP}.zip"

echo ""
echo "=========================================="
echo "  Creating Deployment Package"
echo "=========================================="
echo ""

# Check if zip is available
if ! command -v zip >/dev/null 2>&1; then
  log_warn "zip command not found, using tar instead"
  USE_TAR=true
else
  USE_TAR=false
fi

# Files and directories to include
INCLUDE_FILES=(
  "package.json"
  "package-lock.json"
  "tsconfig.json"
  "drizzle.config.ts"
  "vite.config.ts"
  "tailwind.config.ts"
  "postcss.config.js"
  "components.json"
  "theme.json"
  "deploy_ubuntu.sh"
)

INCLUDE_DIRS=(
  "client"
  "server"
  "shared"
  "public"
)

# Files and directories to exclude
EXCLUDE_PATTERNS=(
  "node_modules"
  ".git"
  "dist"
  ".env*"
  "*.log"
  ".replit"
  "replit.nix"
  ".upm"
  ".config"
  ".cache"
  "attached_assets"
  "create_deploy_zip.sh"
)

log_info "Preparing files for packaging..."

# Create temporary directory
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

PROJECT_NAME="secure-webrtc-app"
PACKAGE_DIR="$TEMP_DIR/$PROJECT_NAME"
mkdir -p "$PACKAGE_DIR"

# Copy files
for file in "${INCLUDE_FILES[@]}"; do
  if [[ -f "$file" ]]; then
    cp "$file" "$PACKAGE_DIR/"
    log_info "Added: $file"
  fi
done

# Copy directories
for dir in "${INCLUDE_DIRS[@]}"; do
  if [[ -d "$dir" ]]; then
    cp -r "$dir" "$PACKAGE_DIR/"
    log_info "Added: $dir/"
  fi
done

# Remove excluded patterns from copied directories
for pattern in "${EXCLUDE_PATTERNS[@]}"; do
  find "$PACKAGE_DIR" -name "$pattern" -exec rm -rf {} + 2>/dev/null || true
done

# Make deploy script executable
chmod +x "$PACKAGE_DIR/deploy_ubuntu.sh"

# Create the archive
log_info "Creating archive..."

if [[ "$USE_TAR" == "true" ]]; then
  TAR_NAME="secure-webrtc-deploy-${TIMESTAMP}.tar.gz"
  (cd "$TEMP_DIR" && tar -czf "$TAR_NAME" "$PROJECT_NAME")
  mv "$TEMP_DIR/$TAR_NAME" "./$TAR_NAME"
  ARCHIVE_NAME="$TAR_NAME"
else
  (cd "$TEMP_DIR" && zip -rq "$ZIP_NAME" "$PROJECT_NAME")
  mv "$TEMP_DIR/$ZIP_NAME" "./$ZIP_NAME"
  ARCHIVE_NAME="$ZIP_NAME"
fi

# Get file size
FILE_SIZE=$(du -h "./$ARCHIVE_NAME" | cut -f1)

echo ""
echo "=========================================="
echo "  Package Created Successfully!"
echo "=========================================="
echo ""
log_info "Archive: $ARCHIVE_NAME"
log_info "Size: $FILE_SIZE"
echo ""
echo "To deploy on Ubuntu 24.04 LTS:"
echo ""
echo "  1. Copy the archive to your server:"
echo "     scp $ARCHIVE_NAME user@your-server:~/"
echo ""
echo "  2. SSH into your server:"
echo "     ssh user@your-server"
echo ""
echo "  3. Run the deployment script:"
echo "     sudo bash -c 'unzip ~/$ARCHIVE_NAME -d /tmp && /tmp/$PROJECT_NAME/deploy_ubuntu.sh /tmp/$PROJECT_NAME'"
echo ""
echo "  Or use this one-liner:"
echo "     sudo ./deploy_ubuntu.sh \$(pwd)/$ARCHIVE_NAME"
echo ""
