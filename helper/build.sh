#!/bin/bash
# Build script for cross-platform binaries

set -e

echo "🔨 Building SECURE.LINK P2P Helper..."
echo ""

# Create builds directory
mkdir -p builds

# Version
VERSION="1.0.0"

# Build for different platforms
echo "📦 Building for Windows (amd64)..."
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o builds/securelink-helper-windows-amd64.exe main.go

echo "📦 Building for macOS (amd64)..."
GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o builds/securelink-helper-macos-amd64 main.go

echo "📦 Building for macOS (arm64 - M1/M2)..."
GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o builds/securelink-helper-macos-arm64 main.go

echo "📦 Building for Linux (amd64)..."
GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o builds/securelink-helper-linux-amd64 main.go

echo "📦 Building for Linux (arm64)..."
GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o builds/securelink-helper-linux-arm64 main.go

echo ""
echo "✅ Build complete! Binaries are in ./builds/"
echo ""
ls -lh builds/
