package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
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
)

const (
	// Protocol ID for WebRTC signaling
	SignalingProtocol = "/securelink/signaling/1.0.0"
	
	// WebSocket server port
	WSPort = 52100
)

// Message types
type Message struct {
	Type    string          `json:"type"`
	From    string          `json:"from,omitempty"`
	To      string          `json:"to,omitempty"`
	Data    json.RawMessage `json:"data,omitempty"`
	PeerID  string          `json:"peerId,omitempty"`
	RoomID  string          `json:"roomId,omitempty"`
}

// Helper represents the P2P helper application
type Helper struct {
	ctx        context.Context
	cancel     context.CancelFunc
	host       host.Host
	dht        *dht.IpfsDHT
	wsUpgrader websocket.Upgrader
	wsConn     *websocket.Conn
	wsLock     sync.Mutex
	peers      map[string]network.Stream
	peersLock  sync.RWMutex
}

// NewHelper creates a new P2P helper instance
func NewHelper(ctx context.Context) (*Helper, error) {
	ctx, cancel := context.WithCancel(ctx)
	
	// Load or generate persistent peer identity
	privKey, err := loadOrCreateIdentity()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("failed to load identity: %w", err)
	}

	// Create libp2p host with Noise security
	connManager, err := connmgr.NewConnManager(100, 400, connmgr.WithGracePeriod(time.Minute))
	if err != nil {
		cancel()
		return nil, fmt.Errorf("failed to create connection manager: %w", err)
	}

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
		libp2p.EnableAutoRelayWithStaticRelays([]peer.AddrInfo{}),
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
		return nil, fmt.Errorf("failed to create DHT: %w", err)
	}

	// Bootstrap the DHT
	if err := kadDHT.Bootstrap(ctx); err != nil {
		h.Close()
		cancel()
		return nil, fmt.Errorf("failed to bootstrap DHT: %w", err)
	}

	// Connect to bootstrap nodes
	go bootstrapConnect(ctx, h, kadDHT)

	helper := &Helper{
		ctx:    ctx,
		cancel: cancel,
		host:   h,
		dht:    kadDHT,
		wsUpgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins from localhost
			},
		},
		peers: make(map[string]network.Stream),
	}

	// Set stream handler for incoming signaling
	h.SetStreamHandler(protocol.ID(SignalingProtocol), helper.handleIncomingStream)

	return helper, nil
}

// loadOrCreateIdentity loads or creates a persistent peer identity
func loadOrCreateIdentity() (crypto.PrivKey, error) {
	keyFile := "peer-identity.key"
	
	// Try to load existing key
	if data, err := os.ReadFile(keyFile); err == nil {
		privKey, err := crypto.UnmarshalPrivateKey(data)
		if err == nil {
			log.Println("✓ Loaded existing peer identity")
			return privKey, nil
		}
		log.Println("⚠ Failed to unmarshal existing key, generating new one")
	}

	// Generate new key
	privKey, _, err := crypto.GenerateKeyPairWithReader(crypto.Ed25519, 2048, rand.Reader)
	if err != nil {
		return nil, err
	}

	// Save key for persistence
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

// bootstrapConnect connects to bootstrap nodes
func bootstrapConnect(ctx context.Context, h host.Host, kadDHT *dht.IpfsDHT) {
	// IPFS bootstrap nodes
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
			log.Printf("⚠ Failed to connect to bootstrap peer %s: %v", peerInfo.ID, err)
		} else {
			log.Printf("✓ Connected to bootstrap peer: %s", peerInfo.ID.ShortString())
		}
	}
}

// handleIncomingStream handles incoming signaling streams from remote peers
func (h *Helper) handleIncomingStream(stream network.Stream) {
	remotePeer := stream.Conn().RemotePeer()
	log.Printf("← Incoming signaling stream from %s", remotePeer.ShortString())

	// Store stream
	h.peersLock.Lock()
	h.peers[remotePeer.String()] = stream
	h.peersLock.Unlock()

	defer func() {
		h.peersLock.Lock()
		delete(h.peers, remotePeer.String())
		h.peersLock.Unlock()
		stream.Close()
	}()

	// Read messages from remote peer and forward to browser
	decoder := json.NewDecoder(stream)
	for {
		var msg Message
		if err := decoder.Decode(&msg); err != nil {
			log.Printf("✗ Stream read error from %s: %v", remotePeer.ShortString(), err)
			return
		}

		log.Printf("← Received from %s: %s", remotePeer.ShortString(), msg.Type)

		// Forward to browser WebSocket
		h.wsLock.Lock()
		if h.wsConn != nil {
			if err := h.wsConn.WriteJSON(msg); err != nil {
				log.Printf("✗ Failed to forward to browser: %v", err)
			}
		}
		h.wsLock.Unlock()
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

	// Send local peer ID to browser
	localPeerID := h.host.ID().String()
	if err := conn.WriteJSON(Message{
		Type:   "peer-id",
		PeerID: localPeerID,
	}); err != nil {
		log.Printf("✗ Failed to send peer ID: %v", err)
	} else {
		log.Printf("→ Sent local PeerID to browser: %s", h.host.ID().ShortString())
	}

	defer func() {
		h.wsLock.Lock()
		h.wsConn = nil
		h.wsLock.Unlock()
		conn.Close()
		log.Println("✗ Browser WebSocket disconnected")
	}()

	// Read messages from browser
	for {
		var msg Message
		if err := conn.ReadJSON(&msg); err != nil {
			log.Printf("✗ WebSocket read error: %v", err)
			return
		}

		log.Printf("→ Received from browser: %s", msg.Type)

		// Handle message based on type
		switch msg.Type {
		case "connect-peer":
			// Browser wants to connect to a remote peer
			go h.connectToPeer(msg.To)

		case "offer", "answer", "ice-candidate":
			// Forward WebRTC signaling to remote peer
			go h.forwardToPeer(msg)

		default:
			log.Printf("⚠ Unknown message type: %s", msg.Type)
		}
	}
}

// connectToPeer connects to a remote peer by their PeerID
func (h *Helper) connectToPeer(peerIDStr string) {
	peerID, err := peer.Decode(peerIDStr)
	if err != nil {
		log.Printf("✗ Invalid peer ID: %v", err)
		return
	}

	log.Printf("→ Connecting to peer %s...", peerID.ShortString())

	// Find peer in DHT
	ctx, cancel := context.WithTimeout(h.ctx, 30*time.Second)
	defer cancel()

	peerInfo, err := h.dht.FindPeer(ctx, peerID)
	if err != nil {
		log.Printf("✗ Failed to find peer in DHT: %v", err)
		return
	}

	// Connect to peer
	if err := h.host.Connect(ctx, peerInfo); err != nil {
		log.Printf("✗ Failed to connect to peer: %v", err)
		return
	}

	log.Printf("✓ Connected to peer %s", peerID.ShortString())

	// Open signaling stream
	stream, err := h.host.NewStream(ctx, peerID, protocol.ID(SignalingProtocol))
	if err != nil {
		log.Printf("✗ Failed to open stream: %v", err)
		return
	}

	// Store stream
	h.peersLock.Lock()
	h.peers[peerIDStr] = stream
	h.peersLock.Unlock()

	log.Printf("✓ Signaling stream established with %s", peerID.ShortString())

	// Notify browser
	h.wsLock.Lock()
	if h.wsConn != nil {
		h.wsConn.WriteJSON(Message{
			Type:   "peer-connected",
			PeerID: peerIDStr,
		})
	}
	h.wsLock.Unlock()
}

// forwardToPeer forwards WebRTC signaling to remote peer via libp2p
func (h *Helper) forwardToPeer(msg Message) {
	if msg.To == "" {
		log.Printf("✗ No target peer specified")
		return
	}

	h.peersLock.RLock()
	stream, ok := h.peers[msg.To]
	h.peersLock.RUnlock()

	if !ok {
		log.Printf("✗ No stream to peer %s, connecting first...", msg.To)
		h.connectToPeer(msg.To)
		
		// Wait a bit and retry
		time.Sleep(2 * time.Second)
		h.peersLock.RLock()
		stream, ok = h.peers[msg.To]
		h.peersLock.RUnlock()
		
		if !ok {
			log.Printf("✗ Still no stream to peer %s", msg.To)
			return
		}
	}

	// Send message over libp2p stream
	encoder := json.NewEncoder(stream)
	if err := encoder.Encode(msg); err != nil {
		log.Printf("✗ Failed to send to peer: %v", err)
		
		// Close and remove broken stream
		h.peersLock.Lock()
		delete(h.peers, msg.To)
		h.peersLock.Unlock()
		stream.Close()
		
		return
	}

	log.Printf("→ Forwarded %s to peer", msg.Type)
}

// Start starts the helper application
func (h *Helper) Start() error {
	// Print local peer info
	fmt.Println("\n╔══════════════════════════════════════════════════════════════╗")
	fmt.Println("║          SECURE.LINK P2P Helper Running                     ║")
	fmt.Println("╚══════════════════════════════════════════════════════════════╝")
	fmt.Printf("\n🆔 Your Peer ID: %s\n", h.host.ID().String())
	fmt.Printf("🌐 WebSocket Server: ws://127.0.0.1:%d\n", WSPort)
	fmt.Println("\n📡 Listening addresses:")
	for _, addr := range h.host.Addrs() {
		fmt.Printf("   - %s/p2p/%s\n", addr, h.host.ID().ShortString())
	}
	fmt.Println("\n✓ Ready! Open your browser and connect to the app.")
	fmt.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

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
	
	// Cleanup
	server.Shutdown(context.Background())
	h.cancel()
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
