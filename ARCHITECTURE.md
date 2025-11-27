# SECURE.LINK P2P Architecture

## Complete System Design

### Goal
Full peer-to-peer communication with **no IP exposure** and **no STUN/TURN servers** using a local helper application.

### Architecture Flow

```
Browser (WebRTC) ↔ Helper (WebRTC + libp2p Bridge) ↔ libp2p Overlay ↔ Remote Helper ↔ Remote Browser
```

### How It Works

#### 1. Browser Layer
- Uses standard WebRTC API (RTCPeerConnection)
- Connects to **localhost helper** instead of remote peer
- ICE configuration: `{ urls: "stun:localhost" }` (local only)
- No real IP addresses exposed

#### 2. Helper Application (Go with Pion WebRTC)
The helper acts as a **media relay bridge**:

**WebRTC Side (Browser-facing):**
- Creates Pion WebRTC PeerConnection
- Accepts SDP offers from browser via WebSocket
- Receives DTLS-SRTP media frames from browser
- Sends media frames to browser

**libp2p Side (Peer-facing):**
- Connects to remote helper via libp2p overlay
- Forwards RTP packets through libp2p streams
- Receives RTP packets from remote helper
- Encrypted with Noise protocol

**Bridging Logic:**
```go
Browser RTP → Pion WebRTC → Extract RTP packet → libp2p stream → Remote Helper
Remote Helper → libp2p stream → Inject RTP packet → Pion WebRTC → Browser
```

#### 3. libp2p Overlay Network
- Kademlia DHT for peer discovery
- Persistent PeerIDs (not IP addresses)
- Noise XX encryption
- NAT traversal via hole punching
- No central servers

### Key Components

#### Helper (helper/main.go)
```go
type Helper struct {
    // Browser connection
    wsServer    *http.Server
    wsConn      *websocket.Conn
    
    // WebRTC (Pion)
    peerConn    *webrtc.PeerConnection
    
    // libp2p
    host        host.Host
    dht         *dht.IpfsDHT
    mediaStream network.Stream
}
```

**Responsibilities:**
1. Accept WebSocket from browser for signaling
2. Create Pion WebRTC PeerConnection for browser
3. Handle SDP offer/answer exchange
4. Forward RTP packets to libp2p
5. Receive RTP packets from libp2p
6. Inject packets into WebRTC connection

#### Browser (client/src/lib/webrtc-p2p.ts)
- Connects to `ws://127.0.0.1:52100`
- Creates RTCPeerConnection with local-only ICE
- Sends offer to helper
- Receives answer from helper
- Media flows to helper, not to remote peer

### Media Flow Example (Voice Call)

1. **User A starts microphone:**
   ```
   Browser A: getUserMedia() → audio track
   Browser A: addTrack() to RTCPeerConnection
   Browser A: Creates offer, sends to Helper A via WebSocket
   ```

2. **Helper A processes offer:**
   ```
   Helper A: Receives offer via WebSocket
   Helper A: Creates Pion PeerConnection
   Helper A: setRemoteDescription(offer)
   Helper A: Creates answer
   Helper A: Sends answer to Browser A
   Helper A: Establishes WebRTC with Browser A
   ```

3. **Helper A forwards to Helper B:**
   ```
   Helper A: Receives RTP packets from Browser A
   Helper A: Sends RTP packets via libp2p stream to Helper B
   Helper B: Receives RTP packets from libp2p
   Helper B: Injects RTP into Pion PeerConnection to Browser B
   Browser B: Plays audio from remote stream
   ```

### Security

1. **IP Privacy:**
   - Browser never connects directly to remote peer
   - All media goes through localhost helper
   - libp2p uses PeerIDs, not IP addresses
   - Real IPs never exposed in ICE candidates

2. **Encryption:**
   - Browser ↔ Helper: DTLS-SRTP (WebRTC standard)
   - Helper ↔ Remote Helper: Noise XX + TLS (libp2p)
   - End-to-end encrypted media path

3. **Authentication:**
   - libp2p PeerIDs are cryptographically verified
   - No man-in-the-middle possible
   - Persistent identity stored locally

### Implementation Status

✅ **Completed:**
- Basic helper with libp2p DHT
- WebSocket signaling server
- Browser connection to helper
- Cross-platform build scripts
- Documentation

🚧 **In Progress:**
- Pion WebRTC integration in helper
- RTP packet bridging
- Media stream forwarding

⏸️ **Remaining:**
- Complete WebRTC ↔ libp2p bridge
- Test media flow end-to-end
- Performance optimization
- Error handling improvements

### Building

#### Helper Application
```bash
cd helper
go mod download
./build.sh
```

Produces binaries:
- `securelink-helper-windows-amd64.exe`
- `securelink-helper-macos-amd64`
- `securelink-helper-macos-arm64`
- `securelink-helper-linux-amd64`

#### Browser App
```bash
npm install
npm run build
```

### Usage

1. **Start Helper:**
   ```bash
   ./securelink-helper-*
   # Shows your PeerID
   ```

2. **Open Browser:**
   - Navigate to http://localhost:5000/p2p
   - Copy your PeerID
   - Share with person you want to call

3. **Connect:**
   - Paste their PeerID
   - Click "Connect"
   - Start voice/chat/files

### Advantages Over Traditional WebRTC

| Feature | Traditional WebRTC | SECURE.LINK P2P |
|---------|-------------------|-----------------|
| IP Exposure | ✗ Visible in ICE candidates | ✅ Hidden via libp2p |
| STUN Servers | Required | ✅ Not needed |
| TURN Servers | Required for NATs | ✅ Not needed |
| Central Server | Required for signaling | ✅ Decentralized DHT |
| Cost | TURN servers expensive | ✅ Free |
| Privacy | Moderate | ✅ Maximum |

### Performance Considerations

**Latency:**
- Traditional: Browser ↔ Browser (1 hop)
- P2P Helper: Browser ↔ Helper ↔ libp2p ↔ Remote Helper ↔ Remote Browser (4 hops)
- Expected overhead: +20-50ms

**Bandwidth:**
- No additional overhead (RTP packets forwarded as-is)
- libp2p adds ~50 bytes per packet for encryption/framing

**CPU:**
- Helper: ~5-10% for packet forwarding
- No transcoding needed

### Troubleshooting

**"Helper not connected"**
- Make sure helper is running before opening browser
- Check port 52100 is not in use

**"Peer not found"**
- Wait 10-20 seconds for DHT discovery
- Both helpers must be connected to DHT bootstrap nodes

**"No audio"**
- Check microphone permissions
- Verify both helpers are running
- Check debug panel for RTP packet logs

### Future Enhancements

- [ ] Video support
- [ ] Group calls (3+ participants)
- [ ] File transfer optimization
- [ ] Mobile helper apps (iOS/Android)
- [ ] Screen sharing
- [ ] Custom TURN fallback option

## Technical Deep Dive

### RTP Packet Format
```
[RTP Header] [Payload]
12 bytes     Variable

Helper extracts full RTP packet, wraps in libp2p frame:
[libp2p Header] [RTP Packet]
~50 bytes       12+ bytes
```

### libp2p Stream Protocol
```
Protocol ID: /securelink/media/1.0.0

Frame format:
[Length: 4 bytes] [RTP Packet: N bytes]

Helper A → Helper B:
1. Read RTP from WebRTC
2. Write [length][packet] to libp2p stream
3. Flush

Helper B → Browser B:
1. Read [length] from libp2p stream
2. Read [packet] of length bytes
3. Inject into WebRTC track
```

### Error Recovery
- **Packet loss:** Handled by WebRTC (NACK/FEC)
- **Stream disconnect:** Automatic reconnection via libp2p
- **Helper crash:** Browser shows connection lost, requires restart

## License
MIT
