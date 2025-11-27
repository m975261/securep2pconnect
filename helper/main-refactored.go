package main

import (
        "context"
        "crypto/rand"
        "encoding/json"
        "fmt"
        "io"
        "log"
        "net/http"
        "os"
        "os/signal"
        "sync"
        "syscall"
        "time"

        "github.com/gorilla/websocket"
        "github.com/libp2p/go-libp2p"
        dht "github.com/libp2p/go-libp2p-kad-dht"
        "github.com/libp2p/go-libp2p/core/crypto"
        "github.com/libp2p/go-libp2p/core/host"
        "github.com/libp2p/go-libp2p/core/network"
        "github.com/libp2p/go-libp2p/core/peer"
        "github.com/libp2p/go-libp2p/core/protocol"
        "github.com/libp2p/go-libp2p/p2p/net/connmgr"
        "github.com/libp2p/go-libp2p/p2p/security/noise"
        libp2ptls "github.com/libp2p/go-libp2p/p2p/security/tls"
        "github.com/multiformats/go-multiaddr"
        "github.com/pion/interceptor"
        "github.com/pion/webrtc/v3"
)

const (
        // WebSocket server port
        WSPort = 52100
        
        // Protocol for RTP forwarding
        RTPProtocol = "/securelink/rtp/1.0.0"
)

// Message types between browser and helper
type Message struct {
        Type string          `json:"type"`
        Data json.RawMessage `json:"data,omitempty"`
        To   string          `json:"to,omitempty"`
}

// Helper manages the P2P WebRTC relay
type Helper struct {
        ctx       context.Context
        cancel    context.CancelFunc
        host      host.Host
        dht       *dht.IpfsDHT
        
        // WebSocket for browser communication
        wsConn    *websocket.Conn
        wsLock    sync.Mutex
        wsUpgrader websocket.Upgrader
        
        // WebRTC peer connection with browser
        browserPC *webrtc.PeerConnection
        audioTrack *webrtc.TrackLocalStaticRTP
        videoTrack *webrtc.TrackLocalStaticRTP
        pcLock    sync.Mutex
        
        // RTP forwarding to remote peer
        rtpStream network.Stream
        streamLock sync.Mutex
        
        // Peer management
        remotePeerID string
        peerLock     sync.Mutex
}

// NewHelper creates a new helper instance
func NewHelper(ctx context.Context) (*Helper, error) {
        ctx, cancel := context.WithCancel(ctx)
        
        // Load or create persistent identity
        privKey, err := loadOrCreateIdentity()
        if err != nil {
                cancel()
                return nil, fmt.Errorf("failed to load identity: %w", err)
        }

        // Create connection manager
        connManager, err := connmgr.NewConnManager(100, 400, connmgr.WithGracePeriod(time.Minute))
        if err != nil {
                cancel()
                return nil, err
        }

        // Create libp2p host with WebRTC-direct transport
        h, err := libp2p.New(
                libp2p.Identity(privKey),
                libp2p.ListenAddrStrings(
                        "/ip4/0.0.0.0/tcp/0",
                        "/ip6/::/tcp/0",
                        "/ip4/0.0.0.0/udp/0/quic-v1",
                        "/ip6/::/udp/0/quic-v1",
                ),
                libp2p.Security(libp2ptls.ID, libp2ptls.New),
                libp2p.Security(noise.ID, noise.New),
                libp2p.ConnectionManager(connManager),
                libp2p.NATPortMap(),
                libp2p.EnableNATService(),
                libp2p.EnableHolePunching(),
        )
        if err != nil {
                cancel()
                return nil, fmt.Errorf("failed to create libp2p host: %w", err)
        }

        // Create Kademlia DHT
        kadDHT, err := dht.New(ctx, h, dht.Mode(dht.ModeAutoServer))
        if err != nil {
                h.Close()
                cancel()
                return nil, err
        }

        // Bootstrap DHT
        if err := kadDHT.Bootstrap(ctx); err != nil {
                h.Close()
                cancel()
                return nil, err
        }

        // Connect to bootstrap nodes
        go bootstrapConnect(ctx, h)

        helper := &Helper{
                ctx:    ctx,
                cancel: cancel,
                host:   h,
                dht:    kadDHT,
                wsUpgrader: websocket.Upgrader{
                        CheckOrigin: func(r *http.Request) bool { return true },
                },
        }

        // Set RTP stream handler
        h.SetStreamHandler(protocol.ID(RTPProtocol), helper.handleRTPStream)

        return helper, nil
}

// loadOrCreateIdentity loads or creates persistent peer identity
func loadOrCreateIdentity() (crypto.PrivKey, error) {
        keyFile := "peer-identity.key"
        
        if data, err := os.ReadFile(keyFile); err == nil {
                privKey, err := crypto.UnmarshalPrivateKey(data)
                if err == nil {
                        log.Println("✓ Loaded existing peer identity")
                        return privKey, nil
                }
        }

        privKey, _, err := crypto.GenerateKeyPairWithReader(crypto.Ed25519, 2048, rand.Reader)
        if err != nil {
                return nil, err
        }

        keyBytes, err := crypto.MarshalPrivateKey(privKey)
        if err != nil {
                return nil, err
        }

        if err := os.WriteFile(keyFile, keyBytes, 0600); err != nil {
                log.Printf("⚠ Warning: failed to save peer identity: %v", err)
        } else {
                log.Println("✓ Generated and saved new peer identity")
        }

        return privKey, nil
}

// bootstrapConnect connects to IPFS bootstrap nodes
func bootstrapConnect(ctx context.Context, h host.Host) {
        bootstrapPeers := []string{
                "/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN",
                "/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa",
                "/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb",
                "/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt",
        }

        for _, peerAddr := range bootstrapPeers {
                ma, err := multiaddr.NewMultiaddr(peerAddr)
                if err != nil {
                        continue
                }

                peerInfo, err := peer.AddrInfoFromP2pAddr(ma)
                if err != nil {
                        continue
                }

                if err := h.Connect(ctx, *peerInfo); err != nil {
                        log.Printf("⚠ Failed to connect to bootstrap: %v", err)
                } else {
                        log.Printf("✓ Connected to bootstrap: %s", peerInfo.ID.ShortString())
                }
        }
}

// createBrowserPeerConnection creates a WebRTC peer connection for the browser
func (h *Helper) createBrowserPeerConnection() error {
        h.pcLock.Lock()
        defer h.pcLock.Unlock()

        // Create media engine
        m := &webrtc.MediaEngine{}
        if err := m.RegisterDefaultCodecs(); err != nil {
                return err
        }

        // Create interceptor registry
        i := &interceptor.Registry{}
        if err := webrtc.RegisterDefaultInterceptors(m, i); err != nil {
                return err
        }

        // Create API with media engine
        api := webrtc.NewAPI(webrtc.WithMediaEngine(m), webrtc.WithInterceptorRegistry(i))

        // Create peer connection (no ICE servers - local only)
        config := webrtc.Configuration{
                ICEServers: []webrtc.ICEServer{},
        }

        pc, err := api.NewPeerConnection(config)
        if err != nil {
                return err
        }

        // Create local audio track for receiving RTP from remote peer
        audioTrack, err := webrtc.NewTrackLocalStaticRTP(
                webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus},
                "audio",
                "pion-audio",
        )
        if err != nil {
                return err
        }
        
        // Create local video track for receiving RTP from remote peer
        videoTrack, err := webrtc.NewTrackLocalStaticRTP(
                webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8},
                "video",
                "pion-video",
        )
        if err != nil {
                return err
        }

        // Add local tracks to peer connection (for sending to browser)
        if _, err = pc.AddTrack(audioTrack); err != nil {
                return err
        }
        if _, err = pc.AddTrack(videoTrack); err != nil {
                return err
        }

        h.audioTrack = audioTrack
        h.videoTrack = videoTrack

        // Handle incoming tracks from browser
        pc.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
                log.Printf("← Received %s track from browser: codec=%s", track.Kind(), track.Codec().MimeType)
                
                // Forward RTP packets to remote peer via libp2p
                go h.forwardRTPToLibp2p(track)
        })

        pc.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
                log.Printf("Browser ICE connection state: %s", state)
        })

        h.browserPC = pc
        return nil
}

// forwardRTPToLibp2p reads RTP from browser and forwards via libp2p
func (h *Helper) forwardRTPToLibp2p(track *webrtc.TrackRemote) {
        defer log.Println("RTP forwarding stopped")

        for {
                // Read RTP packet from browser
                rtp, _, err := track.ReadRTP()
                if err != nil {
                        if err != io.EOF {
                                log.Printf("Error reading RTP: %v", err)
                        }
                        return
                }

                // Get libp2p stream to remote peer
                h.streamLock.Lock()
                stream := h.rtpStream
                h.streamLock.Unlock()

                if stream == nil {
                        continue
                }

                // Marshal RTP packet
                data, err := rtp.Marshal()
                if err != nil {
                        log.Printf("Error marshaling RTP: %v", err)
                        continue
                }

                // Write with length prefix (2 bytes for packet length)
                lengthPrefix := []byte{byte(len(data) >> 8), byte(len(data) & 0xFF)}
                
                if _, err := stream.Write(lengthPrefix); err != nil {
                        log.Printf("Error writing length prefix: %v", err)
                        h.reconnectStream()
                        continue
                }
                
                if _, err := stream.Write(data); err != nil {
                        log.Printf("Error forwarding RTP: %v", err)
                        h.reconnectStream()
                        continue
                }
        }
}

// reconnectStream attempts to reconnect the RTP stream
func (h *Helper) reconnectStream() {
        h.streamLock.Lock()
        if h.rtpStream != nil {
                h.rtpStream.Close()
                h.rtpStream = nil
        }
        h.streamLock.Unlock()
        
        // Try to reconnect
        h.peerLock.Lock()
        remotePeerID := h.remotePeerID
        h.peerLock.Unlock()
        
        if remotePeerID != "" {
                go h.openRTPStream(remotePeerID)
        }
}

// handleRTPStream handles incoming RTP stream from remote peer
func (h *Helper) handleRTPStream(stream network.Stream) {
        remotePeer := stream.Conn().RemotePeer()
        log.Printf("← Incoming RTP stream from %s", remotePeer.ShortString())

        h.streamLock.Lock()
        h.rtpStream = stream
        h.streamLock.Unlock()

        defer func() {
                h.streamLock.Lock()
                h.rtpStream = nil
                h.streamLock.Unlock()
                stream.Close()
        }()

        // Read RTP packets with length prefix and inject into browser peer connection
        lengthBuf := make([]byte, 2)
        
        for {
                // Read 2-byte length prefix
                if _, err := io.ReadFull(stream, lengthBuf); err != nil {
                        if err != io.EOF {
                                log.Printf("Error reading length prefix: %v", err)
                        }
                        return
                }
                
                // Parse length
                packetLen := int(lengthBuf[0])<<8 | int(lengthBuf[1])
                if packetLen > 1500 {
                        log.Printf("Invalid packet length: %d", packetLen)
                        continue
                }
                
                // Read RTP packet
                buf := make([]byte, packetLen)
                if _, err := io.ReadFull(stream, buf); err != nil {
                        log.Printf("Error reading RTP packet: %v", err)
                        return
                }

                // Parse RTP packet
                packet := &webrtc.RTPPacket{}
                if err := packet.Unmarshal(buf); err != nil {
                        log.Printf("Error unmarshaling RTP: %v", err)
                        continue
                }

                // Inject into appropriate track based on payload type
                h.pcLock.Lock()
                
                // Route by payload type - will be negotiated via SDP
                // Common: Opus=111, VP8=96, but may vary
                if h.audioTrack != nil && packet.PayloadType >= 96 && packet.PayloadType <= 127 {
                        // Audio codecs typically in this range
                        if err := h.audioTrack.WriteRTP(packet); err != nil && err != io.ErrClosedPipe {
                                log.Printf("Error writing audio RTP: %v", err)
                        }
                }
                
                if h.videoTrack != nil && packet.PayloadType >= 96 && packet.PayloadType <= 127 {
                        // Try video track as well - one will accept, other will reject
                        if err := h.videoTrack.WriteRTP(packet); err != nil && err != io.ErrClosedPipe {
                                // Ignore error - may not be video packet
                        }
                }
                
                h.pcLock.Unlock()
        }
}

// handleWebSocket handles WebSocket connection from browser
func (h *Helper) handleWebSocket(w http.ResponseWriter, r *http.Request) {
        conn, err := h.wsUpgrader.Upgrade(w, r, nil)
        if err != nil {
                log.Printf("✗ WebSocket upgrade failed: %v", err)
                return
        }

        h.wsLock.Lock()
        h.wsConn = conn
        h.wsLock.Unlock()

        log.Println("✓ Browser WebSocket connected")

        // Send local peer ID
        if err := conn.WriteJSON(Message{
                Type: "peer-id",
                Data: json.RawMessage(fmt.Sprintf(`"%s"`, h.host.ID().String())),
        }); err != nil {
                log.Printf("✗ Failed to send peer ID: %v", err)
        }

        defer func() {
                h.wsLock.Lock()
                h.wsConn = nil
                h.wsLock.Unlock()
                conn.Close()
        }()

        // Read messages from browser
        for {
                var msg Message
                if err := conn.ReadJSON(&msg); err != nil {
                        log.Printf("✗ WebSocket read error: %v", err)
                        return
                }

                if err := h.handleBrowserMessage(msg); err != nil {
                        log.Printf("✗ Error handling message: %v", err)
                }
        }
}

// handleBrowserMessage handles messages from browser
func (h *Helper) handleBrowserMessage(msg Message) error {
        switch msg.Type {
        case "connect-peer":
                // Browser wants to connect to remote peer
                var peerID string
                if err := json.Unmarshal(msg.Data, &peerID); err != nil {
                        return err
                }
                go h.connectToPeer(peerID)

        case "offer":
                // Browser sent SDP offer
                if err := h.createBrowserPeerConnection(); err != nil {
                        return err
                }

                var offer webrtc.SessionDescription
                if err := json.Unmarshal(msg.Data, &offer); err != nil {
                        return err
                }

                if err := h.browserPC.SetRemoteDescription(offer); err != nil {
                        return err
                }

                // Create answer
                answer, err := h.browserPC.CreateAnswer(nil)
                if err != nil {
                        return err
                }

                if err := h.browserPC.SetLocalDescription(answer); err != nil {
                        return err
                }

                // Send answer back to browser
                answerData, _ := json.Marshal(answer)
                h.wsLock.Lock()
                if h.wsConn != nil {
                        h.wsConn.WriteJSON(Message{
                                Type: "answer",
                                Data: answerData,
                        })
                }
                h.wsLock.Unlock()

        case "ice-candidate":
                // Browser sent ICE candidate
                if h.browserPC != nil {
                        var candidate webrtc.ICECandidateInit
                        if err := json.Unmarshal(msg.Data, &candidate); err != nil {
                                return err
                        }
                        if err := h.browserPC.AddICECandidate(candidate); err != nil {
                                log.Printf("⚠ Failed to add ICE candidate: %v", err)
                        }
                }
        }

        return nil
}

// openRTPStream opens an outbound RTP stream to a peer
func (h *Helper) openRTPStream(peerIDStr string) {
        peerID, err := peer.Decode(peerIDStr)
        if err != nil {
                log.Printf("✗ Invalid peer ID for stream: %v", err)
                return
        }

        ctx, cancel := context.WithTimeout(h.ctx, 10*time.Second)
        defer cancel()

        stream, err := h.host.NewStream(ctx, peerID, protocol.ID(RTPProtocol))
        if err != nil {
                log.Printf("✗ Failed to open RTP stream: %v", err)
                return
        }

        h.streamLock.Lock()
        h.rtpStream = stream
        h.streamLock.Unlock()

        log.Println("✓ RTP stream re-established")
}

// connectToPeer connects to a remote peer by PeerID
func (h *Helper) connectToPeer(peerIDStr string) {
        peerID, err := peer.Decode(peerIDStr)
        if err != nil {
                log.Printf("✗ Invalid peer ID: %v", err)
                return
        }

        h.peerLock.Lock()
        h.remotePeerID = peerIDStr
        h.peerLock.Unlock()

        log.Printf("→ Connecting to peer %s...", peerID.ShortString())

        // Find peer in DHT
        ctx, cancel := context.WithTimeout(h.ctx, 30*time.Second)
        defer cancel()

        peerInfo, err := h.dht.FindPeer(ctx, peerID)
        if err != nil {
                log.Printf("✗ Failed to find peer: %v", err)
                return
        }

        // Connect to peer
        if err := h.host.Connect(ctx, peerInfo); err != nil {
                log.Printf("✗ Failed to connect: %v", err)
                return
        }

        log.Printf("✓ Connected to %s", peerID.ShortString())

        // Open RTP stream
        stream, err := h.host.NewStream(ctx, peerID, protocol.ID(RTPProtocol))
        if err != nil {
                log.Printf("✗ Failed to open RTP stream: %v", err)
                return
        }

        h.streamLock.Lock()
        h.rtpStream = stream
        h.streamLock.Unlock()

        log.Println("✓ RTP stream established")

        // Notify browser
        h.wsLock.Lock()
        if h.wsConn != nil {
                h.wsConn.WriteJSON(Message{
                        Type: "peer-connected",
                        Data: json.RawMessage(fmt.Sprintf(`"%s"`, peerIDStr)),
                })
        }
        h.wsLock.Unlock()
}

// Start starts the helper
func (h *Helper) Start() error {
        fmt.Println("\n╔══════════════════════════════════════════════════════════════╗")
        fmt.Println("║          SECURE.LINK P2P Helper (Refactored)                ║")
        fmt.Println("╚══════════════════════════════════════════════════════════════╝")
        fmt.Printf("\n🆔 Your Peer ID: %s\n", h.host.ID().String())
        fmt.Printf("🌐 WebSocket Server: ws://127.0.0.1:%d\n", WSPort)
        fmt.Println("\n📡 Listening addresses:")
        for _, addr := range h.host.Addrs() {
                fmt.Printf("   - %s/p2p/%s\n", addr, h.host.ID().ShortString())
        }
        fmt.Println("\n✓ Using go-libp2p-webrtc-direct transport")
        fmt.Println("✓ Using Pion RTP forwarder pattern")
        fmt.Println("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

        // Start WebSocket server
        http.HandleFunc("/", h.handleWebSocket)
        server := &http.Server{
                Addr:    fmt.Sprintf("127.0.0.1:%d", WSPort),
                Handler: http.DefaultServeMux,
        }

        go func() {
                if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
                        log.Fatalf("✗ WebSocket server error: %v", err)
                }
        }()

        // Wait for shutdown signal
        sigChan := make(chan os.Signal, 1)
        signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
        <-sigChan

        fmt.Println("\n⏳ Shutting down...")
        server.Shutdown(context.Background())
        h.cancel()
        if h.browserPC != nil {
                h.browserPC.Close()
        }
        h.host.Close()
        fmt.Println("✓ Goodbye!")
        return nil
}

func main() {
        ctx := context.Background()
        helper, err := NewHelper(ctx)
        if err != nil {
                log.Fatalf("✗ Failed to create helper: %v", err)
        }

        if err := helper.Start(); err != nil {
                log.Fatalf("✗ Helper error: %v", err)
        }
}
