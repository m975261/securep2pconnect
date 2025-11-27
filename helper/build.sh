#!/bin/bash
# Build script for cross-platform binaries

set -e

echo "🔨 Building SECURE.LINK P2P Helper (Refactored)..."
echo ""

# Check Go version
GO_VERSION=$(go version | awk '{print $3}' | sed 's/go//')
REQUIRED_VERSION="1.21"

if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$GO_VERSION" | sort -V | head -n1)" != "$REQUIRED_VERSION" ]; then
    echo "❌ Error: Go $REQUIRED_VERSION or higher required (found $GO_VERSION)"
    echo "Install Go 1.21+: https://go.dev/dl/"
    exit 1
fi

echo "✓ Using Go $GO_VERSION"
echo ""

# Create builds directory
mkdir -p builds

# Download dependencies
echo "📥 Downloading Go dependencies..."
go mod download
go mod tidy

echo ""
echo "📦 Building for different platforms..."
echo ""

# Build for different platforms using main-refactored.go
echo "📦 Windows (amd64)..."
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o builds/securelink-helper-windows-amd64.exe main-refactored.go

echo "📦 macOS (amd64 - Intel)..."
GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o builds/securelink-helper-macos-amd64 main-refactored.go

echo "📦 macOS (arm64 - M1/M2/M3)..."
GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o builds/securelink-helper-macos-arm64 main-refactored.go

echo "📦 Linux (amd64)..."
GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o builds/securelink-helper-linux-amd64 main-refactored.go

echo "📦 Linux (arm64)..."
GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o builds/securelink-helper-linux-arm64 main-refactored.go

echo ""
echo "✅ Build complete! Binaries are in ./builds/"
echo ""
echo "📊 Binary sizes:"
ls -lh builds/
echo ""
echo "🚀 To run: ./builds/securelink-helper-* (choose your platform)"
