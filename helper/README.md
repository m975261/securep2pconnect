# SECURE.LINK P2P Helper

A lightweight native helper application that provides true peer-to-peer connections with hidden IP addresses using libp2p overlay network.

## What It Does

The helper application runs locally on your device and:

- ✅ **Hides your real IP address** - Peers only see your libp2p PeerID
- ✅ **No STUN/TURN servers needed** - Uses libp2p DHT for peer discovery
- ✅ **NAT traversal** - Built-in hole punching and relay support
- ✅ **End-to-end encryption** - Noise XX handshake between peers
- ✅ **Decentralized** - No central signaling server required

## Architecture

```
Browser ↔ WebSocket (127.0.0.1:52100) ↔ Helper ↔ libp2p DHT ↔ Remote Helper ↔ Remote Browser
```

## Download & Run

### Windows

1. Download `securelink-helper-windows-amd64.exe`
2. Double-click to run (Windows may show a warning - click "More info" → "Run anyway")
3. A console window will open showing your Peer ID
4. Open SECURE.LINK in your browser

### macOS

1. Download `securelink-helper-macos-amd64` (Intel) or `securelink-helper-macos-arm64` (M1/M2)
2. Open Terminal and run:
   ```bash
   chmod +x securelink-helper-macos-*
   ./securelink-helper-macos-*
   ```
3. Copy your Peer ID from the console
4. Open SECURE.LINK in your browser

### Linux

1. Download `securelink-helper-linux-amd64`
2. Open Terminal and run:
   ```bash
   chmod +x securelink-helper-linux-amd64
   ./securelink-helper-linux-amd64
   ```
3. Copy your Peer ID from the console
4. Open SECURE.LINK in your browser

## How to Connect to a Peer

1. **Start the helper** on both devices
2. **Share your Peer ID** with the person you want to connect to
3. **In the browser**, paste their Peer ID in the connection field
4. **Start voice/chat** - The connection happens over the encrypted libp2p network

## Building from Source

### Requirements
- **Go 1.21 or higher** (required by libp2p dependencies)

Check your version:
```bash
go version  # Should show "go1.21" or higher
```

Install Go 1.21+:
- **macOS**: `brew install go`
- **Linux**: https://go.dev/doc/install
- **Windows**: https://go.dev/dl/

### Build Instructions

```bash
cd helper
go mod download
go mod tidy
./build.sh
```

Binaries will be in `./builds/` for all platforms (Windows, macOS, Linux)

### Pre-built Binaries

⚠️ **Pre-built binaries are NOT yet available.**

You must build from source using Go 1.21+. The download links in the web UI are placeholders and will show corrupted/missing file errors.

If you don't have Go installed, download it from https://go.dev/dl/

## Technical Details

- **Protocol**: libp2p with Kademlia DHT
- **Encryption**: Noise XX + TLS 1.3
- **NAT Traversal**: AutoNAT + Hole Punching
- **Transport**: TCP, QUIC
- **Media**: Pion WebRTC for RTP packet bridging
- **Codecs**: Opus (audio), VP8 (video)
- **Binary Size**: ~10-15 MB (compressed)
- **Memory Usage**: ~40-60 MB
- **Bootstrap**: IPFS public bootstrap nodes
- **Framing**: Length-prefixed RTP packets for stream integrity

## Security

- All P2P communication is encrypted with Noise protocol
- WebRTC media streams use DTLS + SRTP (AES-256)
- No data passes through central servers
- Real IP addresses never exposed to remote peers
- Persistent peer identity stored locally

## Troubleshooting

**"Failed to connect to peer"**
- Make sure both helpers are running
- Check firewall settings (helper needs outbound connections)
- Wait 10-20 seconds for DHT discovery

**"WebSocket connection refused"**
- Make sure the helper is running before opening the browser
- Check that port 52100 is not in use by another application

**"No relay candidates"**
- This is normal! The helper provides the relay via libp2p
- You should see "relay" type ICE candidates in the debug panel

## License

MIT
