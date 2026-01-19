#!/bin/bash

echo "Setting up GitHub remote..."
git remote remove origin 2>/dev/null
git remote add origin https://github.com/m975261/securep2pconnect.git

echo "Staging all files..."
git add -A

echo "Creating commit..."
git commit -m "SECURE.LINK - Secure P2P WebRTC Communication" --allow-empty

echo "Pushing to GitHub..."
git push -u origin main --force

echo ""
echo "Done! Check: https://github.com/m975261/securep2pconnect"
