#!/usr/bin/env bash
#
# SECURE.LINK - Create Project Zip for Deployment
#
# Usage: ./create_project_zip.sh [output_name]
#
# This script creates a clean zip file of the project
# ready for deployment on Ubuntu using deploy_ubuntu.sh
#

set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# Output filename
OUTPUT_NAME="${1:-secure-link-project}"
OUTPUT_FILE="${OUTPUT_NAME}.zip"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_FILE_TIMESTAMPED="${OUTPUT_NAME}_${TIMESTAMP}.zip"

echo ""
echo "=========================================="
echo "  Creating Project Zip for Deployment"
echo "=========================================="
echo ""

# Get project root directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

log_info "Project directory: $PROJECT_DIR"

# Create temp directory for clean export
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

EXPORT_DIR="$TEMP_DIR/secure-link"
mkdir -p "$EXPORT_DIR"

log_info "Copying project files..."

# Copy essential files and directories
# Server files
cp -r server "$EXPORT_DIR/"
cp -r shared "$EXPORT_DIR/"
cp -r client "$EXPORT_DIR/"

# Configuration files
cp package.json "$EXPORT_DIR/"
cp package-lock.json "$EXPORT_DIR/" 2>/dev/null || true
cp tsconfig.json "$EXPORT_DIR/"
cp vite.config.ts "$EXPORT_DIR/"
cp drizzle.config.ts "$EXPORT_DIR/"
cp tailwind.config.ts "$EXPORT_DIR/" 2>/dev/null || true
cp postcss.config.js "$EXPORT_DIR/" 2>/dev/null || true
cp components.json "$EXPORT_DIR/" 2>/dev/null || true
cp theme.json "$EXPORT_DIR/" 2>/dev/null || true

# Copy deployment script
cp deploy_ubuntu.sh "$EXPORT_DIR/"

# Exclude unnecessary files
log_info "Cleaning up unnecessary files..."
rm -rf "$EXPORT_DIR/node_modules" 2>/dev/null || true
rm -rf "$EXPORT_DIR/.git" 2>/dev/null || true
rm -rf "$EXPORT_DIR/dist" 2>/dev/null || true
rm -rf "$EXPORT_DIR/.replit" 2>/dev/null || true
rm -rf "$EXPORT_DIR/replit.nix" 2>/dev/null || true
rm -rf "$EXPORT_DIR/.config" 2>/dev/null || true
rm -rf "$EXPORT_DIR/.cache" 2>/dev/null || true
rm -rf "$EXPORT_DIR/.upm" 2>/dev/null || true
rm -f "$EXPORT_DIR"/*.log 2>/dev/null || true
rm -f "$EXPORT_DIR"/.env* 2>/dev/null || true

# Remove any .local files (contain machine-specific mDNS addresses)
find "$EXPORT_DIR" -name "*.local" -delete 2>/dev/null || true

# Create the zip file
log_info "Creating zip file..."
cd "$TEMP_DIR"
zip -rq "$PROJECT_DIR/$OUTPUT_FILE" secure-link

# Also create timestamped version
cp "$PROJECT_DIR/$OUTPUT_FILE" "$PROJECT_DIR/$OUTPUT_FILE_TIMESTAMPED"

echo ""
echo "=========================================="
echo "  Zip File Created Successfully!"
echo "=========================================="
echo ""
log_info "Output file: $OUTPUT_FILE"
log_info "Timestamped: $OUTPUT_FILE_TIMESTAMPED"
echo ""
echo "File size: $(du -h "$PROJECT_DIR/$OUTPUT_FILE" | cut -f1)"
echo ""
echo "To deploy on Ubuntu:"
echo "  1. Upload both files to your server:"
echo "     scp $OUTPUT_FILE deploy_ubuntu.sh user@server:~"
echo ""
echo "  2. SSH into your server and run:"
echo "     sudo ./deploy_ubuntu.sh ~/$OUTPUT_FILE"
echo ""

# List contents
log_info "Zip contents:"
unzip -l "$PROJECT_DIR/$OUTPUT_FILE" | head -30
echo "  ... (truncated)"
echo ""
