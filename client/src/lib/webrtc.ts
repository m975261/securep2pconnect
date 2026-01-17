import { useEffect, useRef, useState, useCallback } from "react";
import { createNoiseSuppressedStream, NoiseSuppressedStream, isNoiseCancellationSupported } from "./audio/audio-pipeline";

export interface TurnConfig {
  urls: string[];
  username: string;
  credential: string;
  stunUrls?: string[];
}

// Test TURN server connectivity
export async function testTurnConnectivity(turnConfig: TurnConfig): Promise<{
  success: boolean;
  candidates: Array<{type: string; protocol: string; address: string}>;
  error?: string;
}> {
  return new Promise((resolve) => {
    const candidates: Array<{type: string; protocol: string; address: string}> = [];
    let completed = false;
    
    console.log('Testing TURN connectivity with config:', {
      urls: turnConfig.urls,
      usernameLength: turnConfig.username?.length,
      credentialLength: turnConfig.credential?.length
    });
    
    const pc = new RTCPeerConnection({
      iceServers: [{
        urls: turnConfig.urls,
        username: turnConfig.username,
        credential: turnConfig.credential,
      }],
      iceTransportPolicy: 'relay',
    });
    
    // Create a data channel to trigger ICE gathering
    pc.createDataChannel('test');
    
    // Timeout after 15 seconds
    const timeout = setTimeout(() => {
      if (!completed) {
        completed = true;
        pc.close();
        console.log('TURN test timeout, candidates found:', candidates.length);
        resolve({
          success: candidates.length > 0,
          candidates,
          error: candidates.length === 0 ? 'Timeout: No relay candidates. TURN server may be unreachable or credentials invalid.' : undefined
        });
      }
    }, 15000);
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('TURN test candidate:', event.candidate.type, event.candidate.protocol, event.candidate.address);
        candidates.push({
          type: event.candidate.type || 'unknown',
          protocol: event.candidate.protocol || 'unknown',
          address: event.candidate.address || 'hidden'
        });
      }
    };
    
    pc.onicegatheringstatechange = () => {
      console.log('TURN test ICE gathering state:', pc.iceGatheringState);
      if (pc.iceGatheringState === 'complete' && !completed) {
        completed = true;
        clearTimeout(timeout);
        pc.close();
        console.log('TURN test complete, candidates found:', candidates.length);
        resolve({
          success: candidates.length > 0,
          candidates,
          error: candidates.length === 0 ? 'No relay candidates generated. TURN server credentials may be expired or server unreachable.' : undefined
        });
      }
    };
    
    pc.createOffer().then(offer => {
      return pc.setLocalDescription(offer);
    }).catch(err => {
      if (!completed) {
        completed = true;
        clearTimeout(timeout);
        pc.close();
        console.error('TURN test offer error:', err);
        resolve({
          success: false,
          candidates: [],
          error: `Failed to create offer: ${err.message}`
        });
      }
    });
  });
}

interface WebRTCConfig {
  roomId: string;
  peerId: string;
  nickname?: string;
  turnConfig?: TurnConfig;
  onMessage?: (message: any) => void;
  onFileReceive?: (file: { name: string; type: string; size: number; data: ArrayBuffer; from?: string; fromNickname?: string }) => void;
  onPeerConnected?: (peerInfo?: { nickname?: string }) => void;
  onPeerDisconnected?: () => void;
  onRemoteStream?: (stream: MediaStream | null) => void;
  onPeerNCStatusChange?: (enabled: boolean) => void;
}

interface SendFileOptions {
  onProgress?: (progress: number) => void;
}

export type ConnectionMode = 'pending' | 'p2p' | 'turn' | 'reconnecting';

// Session storage helpers
function getModeStorageKey(roomId: string): string {
  return `connection-mode-${roomId}`;
}

function getPersistedMode(roomId: string): ConnectionMode | null {
  try {
    const stored = sessionStorage.getItem(getModeStorageKey(roomId));
    return (stored === 'p2p' || stored === 'turn') ? stored : null;
  } catch { return null; }
}

function persistMode(roomId: string, mode: ConnectionMode): void {
  try {
    if (mode === 'p2p' || mode === 'turn') {
      sessionStorage.setItem(getModeStorageKey(roomId), mode);
    }
  } catch {}
}

function clearPersistedMode(roomId: string): void {
  try { sessionStorage.removeItem(getModeStorageKey(roomId)); } catch {}
}

/**
 * FallbackController - Single authoritative controller for connection mode decisions
 * 
 * State machine: pending → (p2p | turn)
 * 
 * Mode locking rules:
 * - Once mode is locked, it cannot be changed EXCEPT:
 *   - P2P can UPGRADE to TURN (if peer requires TURN for connectivity)
 *   - This is a one-way upgrade path: P2P → TURN is allowed, TURN → P2P is not
 * - This ensures maximum connectivity (TURN always wins) while preferring P2P
 * 
 * Detection strategy:
 * - Mode is detected ONCE from WebRTC stats after ICE connected
 * - Max 3 retry attempts (500ms each) if stats not yet available
 * - No continuous polling - detection stops after lock or max retries
 */
class FallbackController {
  private mode: ConnectionMode = 'pending';
  private locked = false;
  private fallbackTimer: NodeJS.Timeout | null = null;
  private isInitiator = false;
  private roomId = '';
  private onModeChange: ((mode: ConnectionMode, details: ConnectionDetails) => void) | null = null;
  private getTurnConfig: (() => TurnConfig | undefined) | null = null;
  private getPc: (() => RTCPeerConnection | null) | null = null;
  private getWs: (() => WebSocket | null) | null = null;
  private onCreateRelayConnection: (() => void) | null = null;
  
  init(
    roomId: string,
    onModeChange: (mode: ConnectionMode, details: ConnectionDetails) => void,
    getTurnConfig: () => TurnConfig | undefined,
    getPc: () => RTCPeerConnection | null,
    getWs: () => WebSocket | null,
    onCreateRelayConnection: () => void
  ) {
    this.roomId = roomId;
    this.onModeChange = onModeChange;
    this.getTurnConfig = getTurnConfig;
    this.getPc = getPc;
    this.getWs = getWs;
    this.onCreateRelayConnection = onCreateRelayConnection;
    
    // Check for persisted mode
    const persisted = getPersistedMode(roomId);
    if (persisted) {
      console.log('[FallbackController] Restored locked mode:', persisted);
      this.mode = persisted;
      this.locked = true;
      this.onModeChange(persisted, { mode: persisted });
    }
  }
  
  setInitiator(isInitiator: boolean) {
    this.isInitiator = isInitiator;
    console.log('[FallbackController] Initiator set:', isInitiator);
  }
  
  isLocked(): boolean {
    return this.locked;
  }
  
  getMode(): ConnectionMode {
    return this.mode;
  }
  
  // Start the P2P timeout - only called by initiator after first offer
  startP2PTimeout() {
    if (this.locked || this.fallbackTimer) return;
    
    console.log('[FallbackController] Starting 5s P2P timeout');
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = null;
      if (this.locked) return;
      
      const pc = this.getPc?.();
      if (!pc) return;
      
      const state = pc.iceConnectionState;
      if (state !== 'connected' && state !== 'completed') {
        console.log('[FallbackController] P2P timeout - triggering TURN fallback');
        this.triggerTurnFallback();
      }
    }, 5000);
  }
  
  // Cancel the timeout (called when connection succeeds)
  cancelTimeout() {
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }
  
  // Called when ICE reaches connected/completed state
  onConnected() {
    this.cancelTimeout();
    if (this.locked) return;
    
    // Detect mode once from stats
    this.detectModeOnce();
  }
  
  // Called when connection fails
  onFailed() {
    if (this.locked) return;
    
    if (!this.isInitiator) {
      console.log('[FallbackController] Connection failed - not initiator, waiting for offer');
      this.mode = 'reconnecting';
      this.onModeChange?.(this.mode, { mode: this.mode });
      return;
    }
    
    this.triggerTurnFallback();
  }
  
  private detectRetryCount = 0;
  private readonly MAX_DETECT_RETRIES = 3;
  
  // Single mode detection from stats - runs ONCE (with bounded retry)
  private detectModeOnce() {
    if (this.locked) return;
    
    const pc = this.getPc?.();
    if (!pc || pc.connectionState === 'closed') return;
    
    pc.getStats().then(stats => {
      if (this.locked) return; // Double-check after async
      
      const statsArray = Array.from(stats.values());
      const candidatePairs = statsArray.filter((r: any) => r.type === 'candidate-pair');
      
      let selectedPair = candidatePairs.find((r: any) => r.selected === true) ||
                         candidatePairs.find((r: any) => r.state === 'succeeded' && r.nominated) ||
                         candidatePairs.find((r: any) => r.state === 'succeeded');
      
      if (!selectedPair) {
        this.detectRetryCount++;
        if (this.detectRetryCount < this.MAX_DETECT_RETRIES) {
          console.log('[FallbackController] No selected pair - retry', this.detectRetryCount, 'of', this.MAX_DETECT_RETRIES);
          setTimeout(() => {
            if (!this.locked) this.detectModeOnce();
          }, 500);
        } else {
          console.log('[FallbackController] Max retries reached, giving up mode detection');
        }
        return;
      }
      
      // Reset retry count on success
      this.detectRetryCount = 0;
      
      const localCandidate = statsArray.find((s: any) => s.id === selectedPair.localCandidateId);
      const remoteCandidate = statsArray.find((s: any) => s.id === selectedPair.remoteCandidateId);
      
      const localType = localCandidate?.candidateType;
      const remoteType = remoteCandidate?.candidateType;
      const isRelay = localType === 'relay' || remoteType === 'relay';
      
      const detectedMode: ConnectionMode = isRelay ? 'turn' : 'p2p';
      this.lockMode(detectedMode, {
        mode: detectedMode,
        remoteIP: remoteCandidate?.address || remoteCandidate?.ip,
        protocol: localCandidate?.protocol,
        turnServerIP: isRelay ? (localCandidate?.relayAddress || localCandidate?.address) : undefined
      });
    }).catch(err => console.warn('[FallbackController] Stats error:', err));
  }
  
  // Lock mode permanently
  private lockMode(mode: ConnectionMode, details: ConnectionDetails) {
    if (this.locked) return;
    
    console.log('[FallbackController] LOCKING mode:', mode);
    this.mode = mode;
    this.locked = true;
    this.cancelTimeout();
    persistMode(this.roomId, mode);
    this.onModeChange?.(mode, details);
    
    // Broadcast to peer
    const ws = this.getWs?.();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'connection-mode', mode }));
    }
  }
  
  // Force TURN mode and recreate connection
  private triggerTurnFallback() {
    if (this.locked) return;
    
    const turnConfig = this.getTurnConfig?.();
    if (!turnConfig) {
      console.error('[FallbackController] No TURN config for fallback');
      return;
    }
    
    console.log('[FallbackController] Triggering TURN-only fallback');
    this.mode = 'reconnecting';
    this.onModeChange?.(this.mode, { mode: this.mode });
    
    // Delegate connection recreation to hook
    this.onCreateRelayConnection?.();
  }
  
  // Handle mode sync from peer - TURN always wins, P2P accepted if pending
  // Explicit one-way upgrade: P2P → TURN is allowed (see class doc)
  handlePeerMode(peerMode: ConnectionMode) {
    if (peerMode === 'turn') {
      if (this.mode === 'p2p') {
        // One-way upgrade: P2P → TURN (peer requires relay for connectivity)
        console.log('[FallbackController] Upgrading P2P → TURN (peer requires relay)');
        this.upgradeToTurn();
      } else if (!this.locked) {
        // Not locked yet, lock to TURN
        this.lockMode('turn', { mode: 'turn' });
      } else {
        // Already locked to TURN, no action needed
        console.log('[FallbackController] Already locked to TURN');
      }
      return;
    }
    
    // P2P from peer - only accept if not locked
    if (peerMode === 'p2p' && !this.locked && (this.mode === 'pending' || this.mode === 'reconnecting')) {
      this.lockMode('p2p', { mode: 'p2p' });
    } else if (this.locked) {
      console.log('[FallbackController] Ignoring peer mode, already locked:', this.mode);
    }
  }
  
  // Explicit P2P → TURN upgrade (one-way only, see class doc)
  private upgradeToTurn() {
    console.log('[FallbackController] Executing P2P → TURN upgrade');
    this.cancelTimeout();
    this.mode = 'turn';
    this.locked = true;
    persistMode(this.roomId, 'turn');
    this.onModeChange?.('turn', { mode: 'turn' });
    
    // Broadcast upgrade to peer
    const ws = this.getWs?.();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'connection-mode', mode: 'turn' }));
    }
  }
  
  // Reset for new peer
  reset() {
    console.log('[FallbackController] Resetting');
    this.cancelTimeout();
    this.mode = 'pending';
    this.locked = false;
    this.detectRetryCount = 0;
    clearPersistedMode(this.roomId);
    this.onModeChange?.('pending', { mode: 'pending' });
  }
  
  // For TURN fallback - lock to TURN mode after relay connection succeeds
  lockToTurn(details: ConnectionDetails) {
    if (this.locked && this.mode === 'turn') return;
    this.lockMode('turn', details);
  }
}

// Extract IP/host from TURN URL like "turn:1.2.3.4:3478" or "turns:server.example.com:5349"
function extractTurnServerHost(urls: string[]): string | undefined {
  for (const url of urls) {
    // Match turn:host:port or turns:host:port patterns
    const match = url.match(/turns?:\/?\/?([^:/?]+)/);
    if (match && match[1]) {
      return match[1];
    }
  }
  return undefined;
}

export interface ConnectionDetails {
  mode: ConnectionMode;
  localIP?: string;
  remoteIP?: string;
  localPort?: number;
  remotePort?: number;
  protocol?: string;
  turnServerIP?: string;
}

export function useWebRTC(config: WebRTCConfig) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('pending');
  const [connectionDetails, setConnectionDetails] = useState<ConnectionDetails>({ mode: 'pending' });
  const [isNCEnabled, setIsNCEnabled] = useState(false);
  const [peerNCEnabled, setPeerNCEnabled] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const rawStreamRef = useRef<MediaStream | null>(null);
  const noiseSuppressedPipelineRef = useRef<NoiseSuppressedStream | null>(null);
  
  // File transfer state
  const fileMetadataRef = useRef<any>(null);
  const fileChunksRef = useRef<ArrayBuffer[]>([]);
  
  // Reconnection state
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const intentionalDisconnectRef = useRef(false);
  
  // Negotiation state to prevent overlapping offers
  const negotiatingRef = useRef(false);
  const pendingNegotiationRef = useRef(false);
  const pendingStopRef = useRef(false); // Track pending voice stop during negotiation
  
  // Single authoritative fallback controller
  const fallbackControllerRef = useRef<FallbackController>(new FallbackController());
  
  // Use refs for callbacks to prevent reconnections on re-renders
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  });

  const sendMessage = useCallback((message: any) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'chat',
        data: {
          ...message,
          from: configRef.current.peerId,
          fromNickname: configRef.current.nickname,
        },
      }));
    }
  }, []);

  const sendFile = useCallback((file: File, options?: SendFileOptions) => {
    return new Promise<void>((resolve, reject) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error('Cannot send file: WebSocket not connected');
        reject(new Error('WebSocket not connected'));
        return;
      }

      console.log('Starting file transfer:', file.name, 'Size:', file.size);
      const reader = new FileReader();
      reader.onload = () => {
        const arrayBuffer = reader.result as ArrayBuffer;
        
        // Send metadata
        const metadata = {
          name: file.name,
          size: file.size,
          type: file.type,
          from: configRef.current.peerId,
          fromNickname: configRef.current.nickname,
        };
        console.log('Sending file metadata:', metadata);
        ws.send(JSON.stringify({
          type: 'file-metadata',
          data: metadata,
        }));
        
        // Send file in chunks
        const chunkSize = 16384;
        const totalChunks = Math.ceil(arrayBuffer.byteLength / chunkSize);
        let chunksSent = 0;
        
        console.log(`Sending ${totalChunks} chunks...`);
        
        // Send chunks with small delays to allow UI updates
        const sendChunks = async () => {
          for (let offset = 0; offset < arrayBuffer.byteLength; offset += chunkSize) {
            // Check if WebSocket is still connected before sending each chunk
            if (!ws || ws.readyState !== WebSocket.OPEN) {
              console.error('WebSocket disconnected during file transfer');
              reject(new Error('Connection lost during file transfer'));
              return;
            }
            
            const chunk = arrayBuffer.slice(offset, offset + chunkSize);
            const bytes = new Uint8Array(chunk);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64Chunk = btoa(binary);
            ws.send(JSON.stringify({
              type: 'file-chunk',
              data: base64Chunk,
            }));
            
            chunksSent++;
            const progress = Math.round((chunksSent / totalChunks) * 100);
            options?.onProgress?.(progress);
            
            // Yield to event loop to allow UI updates (works even in background tabs)
            await new Promise(resolve => setTimeout(resolve, 0));
          }
          console.log(`Sent ${chunksSent} chunks`);
          
          // Final check before sending EOF
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.error('WebSocket disconnected before sending EOF');
            reject(new Error('Connection lost before completing file transfer'));
            return;
          }
          
          // Send EOF
          console.log('Sending file EOF');
          ws.send(JSON.stringify({
            type: 'file-eof',
            data: null,
          }));
          
          options?.onProgress?.(100);
          console.log('File transfer complete:', file.name);
          resolve();
        };
        
        sendChunks().catch(reject);
      };
      reader.onerror = (error) => {
        console.error('FileReader error:', error);
        reject(error);
      };
      reader.readAsArrayBuffer(file);
    });
  }, []);

  // Helper function to perform negotiation with guard
  const performNegotiation = useCallback(async () => {
    const pc = pcRef.current;
    const ws = wsRef.current;

    // Check if already negotiating or PC is not in stable state
    if (negotiatingRef.current || (pc && pc.signalingState !== 'stable')) {
      console.log(`Negotiation blocked: negotiatingRef=${negotiatingRef.current}, signalingState=${pc?.signalingState}, marking pending`);
      pendingNegotiationRef.current = true;
      return;
    }

    if (!pc || !ws || ws.readyState !== WebSocket.OPEN) {
      console.log('Cannot negotiate: PC or WS not ready');
      return;
    }

    try {
      negotiatingRef.current = true;
      console.log('Creating offer for negotiation, signalingState:', pc.signalingState);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({
        type: 'offer',
        data: offer,
      }));
      console.log('Offer sent, waiting for answer');
      // Note: negotiatingRef will be cleared when answer is received
    } catch (error) {
      console.error('Error during negotiation:', error);
      negotiatingRef.current = false;
      
      // If there was a pending negotiation, retry
      if (pendingNegotiationRef.current) {
        pendingNegotiationRef.current = false;
        console.log('Retrying pending negotiation after error');
        setTimeout(() => performNegotiation(), 100);
      }
    }
  }, []);

  // Send NC status to peer via WebSocket
  const sendNCStatus = useCallback((enabled: boolean) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'nc-status',
        data: { enabled },
      }));
      console.log('[NoiseSuppression] Sent NC status to peer:', enabled);
    }
  }, []);

  const startVoiceChat = useCallback(async () => {
    try {
      console.log('[VoiceChat] Getting microphone access...');
      const rawStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      rawStreamRef.current = rawStream;
      
      // Apply noise suppression if supported
      let streamToUse: MediaStream;
      let ncEnabled = false;
      
      if (isNoiseCancellationSupported()) {
        console.log('[VoiceChat] Applying RNNoise noise suppression...');
        try {
          const pipeline = await createNoiseSuppressedStream(rawStream);
          noiseSuppressedPipelineRef.current = pipeline;
          streamToUse = pipeline.stream;
          ncEnabled = pipeline.isNoiseCancellationEnabled;
          console.log('[VoiceChat] Noise suppression applied:', ncEnabled);
        } catch (err) {
          console.warn('[VoiceChat] Noise suppression failed, using raw stream:', err);
          streamToUse = rawStream;
          ncEnabled = false;
        }
      } else {
        console.log('[VoiceChat] Noise suppression not supported, using raw stream');
        streamToUse = rawStream;
        ncEnabled = false;
      }
      
      localStreamRef.current = streamToUse;
      setIsNCEnabled(ncEnabled);
      sendNCStatus(ncEnabled);
      
      const pc = pcRef.current;
      
      if (pc) {
        streamToUse.getTracks().forEach(track => {
          console.log('Adding audio track to peer connection');
          pc.addTrack(track, streamToUse);
        });
        
        // Renegotiate with guard
        await performNegotiation();
      }

      return streamToUse;
    } catch (error) {
      console.error('Error starting voice chat:', error);
      throw error;
    }
  }, [performNegotiation, sendNCStatus]);

  const stopVoiceChat = useCallback(() => {
    // Prevent stopping voice during active negotiation
    if (negotiatingRef.current) {
      console.log('Deferring stopVoiceChat until negotiation completes');
      pendingStopRef.current = true;
      return;
    }
    
    if (localStreamRef.current) {
      const pc = pcRef.current;
      
      // Stop all tracks
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
        
        // Remove the track from the peer connection only if connection is not closed
        if (pc && pc.signalingState !== 'closed') {
          const sender = pc.getSenders().find(s => s.track === track);
          if (sender) {
            console.log('Removing audio track from peer connection');
            try {
              pc.removeTrack(sender);
            } catch (err) {
              console.warn('Could not remove track:', err);
            }
          }
        }
      });
      
      localStreamRef.current = null;
      
      // Clean up noise suppression pipeline
      if (noiseSuppressedPipelineRef.current) {
        noiseSuppressedPipelineRef.current.cleanup();
        noiseSuppressedPipelineRef.current = null;
      }
      
      // Stop raw stream tracks
      if (rawStreamRef.current) {
        rawStreamRef.current.getTracks().forEach(track => track.stop());
        rawStreamRef.current = null;
      }
      
      // Reset NC status
      setIsNCEnabled(false);
      sendNCStatus(false);
      
      // Renegotiate with guard (only if connection is still open)
      if (pc && pc.signalingState !== 'closed') {
        performNegotiation();
      }
    }
  }, [performNegotiation, sendNCStatus]);

  useEffect(() => {
    // Only reconnect if we don't have a connection or if roomId actually changes
    if (!config.roomId || !config.peerId) return;
    
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // TURN-relay-only WebRTC peer connection (no IP leakage)
    const turnConfig = configRef.current.turnConfig;
    console.log('TURN config available:', !!turnConfig);
    if (turnConfig) {
      console.log('TURN URLs:', JSON.stringify(turnConfig.urls));
      console.log('STUN URLs:', JSON.stringify(turnConfig.stunUrls || []));
      console.log('TURN username length:', turnConfig.username?.length || 0);
      console.log('TURN credential length:', turnConfig.credential?.length || 0);
    }
    
    const iceServers: RTCIceServer[] = [];
    
    // Add STUN servers (note: with iceTransportPolicy='relay', STUN won't be used for candidates but might help with connectivity checks)
    if (turnConfig?.stunUrls && turnConfig.stunUrls.length > 0) {
      iceServers.push({ urls: turnConfig.stunUrls });
    }
    
    // Add TURN servers with credentials
    if (turnConfig) {
      iceServers.push({
        urls: turnConfig.urls,
        username: turnConfig.username,
        credential: turnConfig.credential,
      });
    }

    console.log('ICE servers config:', JSON.stringify(iceServers, null, 2));

    if (iceServers.length === 0) {
      console.warn('No TURN servers configured - audio/video will not work in relay-only mode');
    }
    
    // Queue for outgoing ICE candidates that arrive before WebSocket is ready
    const pendingIceCandidates: RTCIceCandidate[] = [];
    
    // Queue for incoming ICE candidates that arrive before remote description is set
    const pendingRemoteIceCandidates: RTCIceCandidateInit[] = [];

    // Start with P2P-first strategy (iceTransportPolicy: 'all')
    // Will fallback to TURN-only if P2P doesn't connect within timeout
    const pc = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy: 'all', // Try P2P first
      iceCandidatePoolSize: 10,
    });
    pcRef.current = pc;
    
    // Create a data channel to ensure ICE gathering starts even without voice
    // This is needed because without any tracks or data channels, ICE won't start
    const dataChannel = pc.createDataChannel('connection-init', { negotiated: true, id: 0 });
    dataChannel.onopen = () => console.log('[DataChannel] Connection channel opened');
    dataChannel.onclose = () => console.log('[DataChannel] Connection channel closed');

    const controller = fallbackControllerRef.current;

    // Function to create TURN-only relay connection (called by controller)
    const createRelayConnection = () => {
      const turnConfig = configRef.current.turnConfig;
      if (!turnConfig) {
        console.error('[RelayConnection] No TURN config');
        return;
      }
      
      // Close old connection
      pcRef.current?.close();
      
      const newPc = new RTCPeerConnection({
        iceServers: [{ urls: turnConfig.urls, username: turnConfig.username, credential: turnConfig.credential }],
        iceTransportPolicy: 'relay',
        iceCandidatePoolSize: 10,
      });
      pcRef.current = newPc;
      console.log('[RelayConnection] Created new relay-only PeerConnection');
      
      // Create data channel
      const dc = newPc.createDataChannel('connection-init', { negotiated: true, id: 0 });
      dc.onopen = () => console.log('[DataChannel] opened');
      dc.onclose = () => console.log('[DataChannel] closed');
      
      // Re-add local stream
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => newPc.addTrack(track, localStreamRef.current!));
      }
      
      // Setup handlers
      newPc.onicecandidate = (e) => {
        const ws = wsRef.current;
        if (e.candidate && ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ice-candidate', data: e.candidate }));
        }
      };
      
      newPc.oniceconnectionstatechange = () => {
        console.log('[RelayConnection] ICE:', newPc.iceConnectionState);
        if (newPc.iceConnectionState === 'connected' || newPc.iceConnectionState === 'completed') {
          controller.lockToTurn({ mode: 'turn', turnServerIP: extractTurnServerHost(turnConfig.urls) });
        }
      };
      
      newPc.ontrack = (e) => {
        if (e.streams?.[0]) {
          setRemoteStream(e.streams[0]);
          configRef.current.onRemoteStream?.(e.streams[0]);
        }
      };
      
      // Create and send offer
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        newPc.createOffer().then(offer => {
          return newPc.setLocalDescription(offer);
        }).then(() => {
          ws.send(JSON.stringify({ type: 'offer', data: newPc.localDescription }));
          console.log('[RelayConnection] Offer sent');
        }).catch(err => console.error('[RelayConnection] Error:', err));
      }
    };

    // Initialize controller now that createRelayConnection is defined
    controller.init(
      config.roomId,
      (mode, details) => {
        setConnectionMode(mode);
        setConnectionDetails(details);
      },
      () => configRef.current.turnConfig,
      () => pcRef.current,
      () => wsRef.current,
      createRelayConnection
    );

    let candidateCount = 0;
    pc.onicecandidate = (event) => {
      const currentWs = wsRef.current;
      if (event.candidate) {
        candidateCount++;
        console.log('ICE candidate:', event.candidate.type, event.candidate.protocol);
        if (currentWs?.readyState === WebSocket.OPEN) {
          currentWs.send(JSON.stringify({ type: 'ice-candidate', data: event.candidate }));
        } else {
          pendingIceCandidates.push(event.candidate);
        }
      } else {
        console.log('ICE gathering complete, total:', candidateCount);
      }
    };

    // Simple ICE/connection handlers that delegate to controller
    pc.oniceconnectionstatechange = () => {
      console.log('ICE state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        controller.onConnected();
      }
    };

    pc.onicegatheringstatechange = () => {
      console.log('ICE gathering:', pc.iceGatheringState);
    };

    pc.ontrack = (event) => {
      console.log('Remote track received:', event.track.kind);
      if (event.streams?.[0]) {
        setRemoteStream(event.streams[0]);
        configRef.current.onRemoteStream?.(event.streams[0]);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        controller.onConnected();
      } else if (pc.connectionState === 'failed') {
        controller.onFailed();
      }
    };

    pc.onsignalingstatechange = () => {
      console.log('WebRTC signaling state:', pc.signalingState);
      
      // If connection returns to stable and there's a pending negotiation, trigger it
      if (pc.signalingState === 'stable' && pendingNegotiationRef.current) {
        console.log('Signaling state is stable, triggering pending negotiation');
        pendingNegotiationRef.current = false;
        negotiatingRef.current = false; // Ensure flag is clear
        setTimeout(() => performNegotiation(), 100);
      }
    };

    ws.onopen = () => {
      console.log('WebSocket connected');
      // Reset reconnection attempts on successful connection
      reconnectAttemptsRef.current = 0;
      intentionalDisconnectRef.current = false;
      
      const currentWs = wsRef.current;
      if (currentWs && currentWs.readyState === WebSocket.OPEN) {
        currentWs.send(JSON.stringify({
          type: 'join',
          roomId: configRef.current.roomId,
          peerId: configRef.current.peerId,
          nickname: configRef.current.nickname,
        }));
        
        // Flush any queued ICE candidates
        if (pendingIceCandidates.length > 0) {
          console.log('Flushing', pendingIceCandidates.length, 'queued ICE candidates');
          pendingIceCandidates.forEach(candidate => {
            currentWs.send(JSON.stringify({
              type: 'ice-candidate',
              data: candidate,
            }));
          });
          pendingIceCandidates.length = 0; // Clear the queue
        }
      }
    };

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        const currentPc = pcRef.current;
        const currentWs = wsRef.current;

        if (message.type === 'joined') {
          const isJoiner = message.existingPeers.length > 0;
          controller.setInitiator(isJoiner);
          console.log(`[${isJoiner ? 'JOINER' : 'CREATOR'}] Joined room, peers:`, message.existingPeers.length);
          setIsConnected(true);
          setConnectionState('connected');
          
          if (isJoiner) {
            configRef.current.onPeerConnected?.({ nickname: message.existingPeers[0]?.nickname });
            
            // Joiner creates and sends initial offer
            if (currentPc && currentWs?.readyState === WebSocket.OPEN) {
              console.log('[JOINER] Creating initial offer...');
              const offer = await currentPc.createOffer();
              await currentPc.setLocalDescription(offer);
              currentWs.send(JSON.stringify({ type: 'offer', data: offer }));
              console.log('[JOINER] Offer sent');
              
              // Start P2P timeout (initiator only)
              controller.startP2PTimeout();
            }
          }
        } else if (message.type === 'peer-joined') {
          console.log('Peer joined:', message.peerId, message.nickname);
          setIsConnected(true);
          setConnectionState('connected');
          
          // Reset controller for new peer
          controller.reset();
          configRef.current.onPeerConnected?.({ nickname: message.nickname });
        } else if (message.type === 'offer') {
          if (currentPc && currentWs && currentWs.readyState === WebSocket.OPEN) {
            console.log('Received offer');
            
            try {
              await currentPc.setRemoteDescription(new RTCSessionDescription(message.data));
            } catch (sdpError: any) {
              // If SDP error, recreate peer connection
              if (sdpError.message?.includes('m-lines') || sdpError.message?.includes('Failed to set remote')) {
                console.log('[RECONNECT] SDP incompatible, recreating...');
                currentPc.close();
                
                const newPc = new RTCPeerConnection(currentPc.getConfiguration());
                pcRef.current = newPc;
                
                const dc = newPc.createDataChannel('connection-init', { negotiated: true, id: 0 });
                dc.onopen = () => console.log('[DataChannel] opened');
                dc.onclose = () => console.log('[DataChannel] closed');
                
                if (localStreamRef.current) {
                  localStreamRef.current.getTracks().forEach(track => newPc.addTrack(track, localStreamRef.current!));
                }
                
                newPc.onicecandidate = (e) => {
                  if (e.candidate && currentWs.readyState === WebSocket.OPEN) {
                    currentWs.send(JSON.stringify({ type: 'ice-candidate', data: e.candidate }));
                  }
                };
                
                newPc.oniceconnectionstatechange = () => {
                  console.log('ICE state:', newPc.iceConnectionState);
                  if (newPc.iceConnectionState === 'connected' || newPc.iceConnectionState === 'completed') {
                    controller.onConnected();
                  }
                };
                
                newPc.onconnectionstatechange = () => {
                  console.log('Connection state:', newPc.connectionState);
                  if (newPc.connectionState === 'connected') controller.onConnected();
                  else if (newPc.connectionState === 'failed') controller.onFailed();
                };
                
                newPc.ontrack = (e) => {
                  if (e.streams?.[0]) {
                    setRemoteStream(e.streams[0]);
                    configRef.current.onRemoteStream?.(e.streams[0]);
                  }
                };
                
                await newPc.setRemoteDescription(new RTCSessionDescription(message.data));
                const answer = await newPc.createAnswer();
                await newPc.setLocalDescription(answer);
                currentWs.send(JSON.stringify({ type: 'answer', data: answer }));
                console.log('[RECONNECT] Answer sent');
                return;
              }
              throw sdpError;
            }
            
            console.log('Remote description set');
            
            // Add local stream tracks if exist
            if (localStreamRef.current) {
              const existingTracks = currentPc.getSenders().map(s => s.track);
              localStreamRef.current.getTracks().forEach(track => {
                if (!existingTracks.includes(track)) {
                  currentPc.addTrack(track, localStreamRef.current!);
                }
              });
            }
            
            // Create and send answer
            const answer = await currentPc.createAnswer();
            await currentPc.setLocalDescription(answer);
            currentWs.send(JSON.stringify({ type: 'answer', data: answer }));
            console.log('Answer sent');
            
            // Flush any buffered remote ICE candidates
            if (pendingRemoteIceCandidates.length > 0) {
              console.log('Flushing', pendingRemoteIceCandidates.length, 'buffered ICE candidates');
              for (const candidate of pendingRemoteIceCandidates) {
                try {
                  await currentPc.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (err) {
                  console.error('Failed to add buffered ICE candidate:', err);
                }
              }
              pendingRemoteIceCandidates.length = 0;
            }
          }
        } else if (message.type === 'answer') {
          if (currentPc) {
            console.log('Received answer, setting remote description');
            console.log('Current signaling state before answer:', currentPc.signalingState);
            
            // Only set remote description if we're waiting for an answer
            if (currentPc.signalingState === 'have-local-offer') {
              await currentPc.setRemoteDescription(new RTCSessionDescription(message.data));
              console.log('Remote description set, new signaling state:', currentPc.signalingState);
              // Clear negotiating flag when answer is received
              negotiatingRef.current = false;
              
              // Flush any buffered remote ICE candidates
              if (pendingRemoteIceCandidates.length > 0) {
                console.log('Flushing', pendingRemoteIceCandidates.length, 'buffered ICE candidates');
                for (const candidate of pendingRemoteIceCandidates) {
                  try {
                    await currentPc.addIceCandidate(new RTCIceCandidate(candidate));
                  } catch (err) {
                    console.error('Failed to add buffered ICE candidate:', err);
                  }
                }
                pendingRemoteIceCandidates.length = 0;
              }
              
              // Check if voice stop was requested during negotiation
              if (pendingStopRef.current) {
                pendingStopRef.current = false;
                console.log('Executing deferred stopVoiceChat after negotiation');
                setTimeout(() => stopVoiceChat(), 100);
              }
              // Check if there's a pending negotiation
              else if (pendingNegotiationRef.current) {
                pendingNegotiationRef.current = false;
                console.log('Performing pending negotiation after answer');
                setTimeout(() => performNegotiation(), 100);
              }
            } else {
              console.warn('Ignoring answer: not in have-local-offer state (current:', currentPc.signalingState + ')');
            }
          }
        } else if (message.type === 'error') {
          console.error('Server error:', message.error);
          negotiatingRef.current = false;
        } else if (message.type === 'ice-candidate') {
          if (currentPc && message.data) {
            // Parse candidate string to extract IP and type
            // Format: "candidate:foundation component protocol priority ip port typ type ..."
            const candidateStr = message.data.candidate || '';
            const parts = candidateStr.split(' ');
            
            let candidateIP = '';
            let candidatePort = 0;
            let candidateType = '';
            
            // Parse the candidate string
            if (parts.length >= 8) {
              candidateIP = parts[4]; // IP is at index 4
              candidatePort = parseInt(parts[5], 10); // Port is at index 5
              const typIndex = parts.indexOf('typ');
              if (typIndex !== -1 && parts[typIndex + 1]) {
                candidateType = parts[typIndex + 1]; // Type is after "typ"
              }
            }
            
            console.log('Received ICE candidate:', candidateType);
            
            // Check if remote description is set - if not, buffer the candidate
            if (!currentPc.remoteDescription) {
              console.log('Remote description not set yet, buffering ICE candidate');
              pendingRemoteIceCandidates.push(message.data);
            } else {
              try {
                await currentPc.addIceCandidate(new RTCIceCandidate(message.data));
                console.log('Added ICE candidate successfully');
              } catch (err) {
                console.error('Failed to add ICE candidate:', err);
              }
            }
          }
        } else if (message.type === 'chat') {
          console.log('Received chat message:', message.data);
          configRef.current.onMessage?.(message.data);
        } else if (message.type === 'file-metadata') {
          console.log('Received file metadata:', message.data);
          fileMetadataRef.current = message.data;
          fileChunksRef.current = [];
        } else if (message.type === 'file-chunk') {
          // Decode base64 chunk
          const binaryString = atob(message.data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          fileChunksRef.current.push(bytes.buffer);
          if (fileChunksRef.current.length % 10 === 0) {
            console.log(`Received ${fileChunksRef.current.length} chunks so far...`);
          }
        } else if (message.type === 'file-eof') {
          if (!fileMetadataRef.current) {
            console.error('Received EOF without file metadata');
            return;
          }
          
          console.log('Received file EOF, reconstructing file...');
          const capturedMetadata = fileMetadataRef.current;
          const blob = new Blob(fileChunksRef.current, { type: capturedMetadata.type });
          console.log('File reconstructed, size:', blob.size, 'chunks:', fileChunksRef.current.length);
          const reader = new FileReader();
          reader.onload = () => {
            console.log('Calling onFileReceive callback');
            configRef.current.onFileReceive?.({
              name: capturedMetadata.name,
              type: capturedMetadata.type,
              size: capturedMetadata.size,
              data: reader.result as ArrayBuffer,
              from: capturedMetadata.from,
              fromNickname: capturedMetadata.fromNickname,
            });
          };
          reader.readAsArrayBuffer(blob);
          
          fileChunksRef.current = [];
          fileMetadataRef.current = null;
        } else if (message.type === 'peer-left') {
          console.log('Peer left:', message.peerId);
          setIsConnected(false);
          setConnectionState('disconnected');
          setRemoteStream(null);
          setPeerNCEnabled(false);
          // Reset controller when peer leaves
          controller.reset();
          configRef.current.onRemoteStream?.(null);
          configRef.current.onPeerDisconnected?.();
        } else if (message.type === 'nc-status') {
          const ncEnabled = message.data?.enabled ?? false;
          console.log('[NoiseSuppression] Peer NC status:', ncEnabled);
          setPeerNCEnabled(ncEnabled);
          configRef.current.onPeerNCStatusChange?.(ncEnabled);
        } else if (message.type === 'connection-mode') {
          // Let controller handle peer mode sync
          controller.handlePeerMode(message.mode);
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket closed');
      setIsConnected(false);
      setConnectionState('connecting');
      
      // Only attempt to reconnect if this wasn't an intentional disconnect
      if (!intentionalDisconnectRef.current) {
        // Clear any existing reconnect timeout
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        
        // Exponential backoff: 1s, 2s, 4s, 8s, max 10s
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
        reconnectAttemptsRef.current++;
        
        console.log(`Attempting to reconnect in ${delay}ms (attempt ${reconnectAttemptsRef.current})...`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!intentionalDisconnectRef.current && configRef.current.roomId && configRef.current.peerId) {
            console.log('Reconnecting WebSocket...');
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
            const newWs = new WebSocket(wsUrl);
            
            // Reuse the same handlers (they reference wsRef.current and pcRef.current)
            newWs.onopen = ws.onopen;
            newWs.onmessage = ws.onmessage;
            newWs.onclose = ws.onclose;
            newWs.onerror = ws.onerror;
            
            wsRef.current = newWs;
          }
        }, delay);
      } else {
        setConnectionState('disconnected');
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    return () => {
      // Mark this as an intentional disconnect
      intentionalDisconnectRef.current = true;
      
      // Clear any pending reconnection attempts
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      // Cancel controller timeout
      controller.cancelTimeout();
      
      // Only clean up if websocket is actually open/connecting
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      // Only close peer connection if it's not already closed
      if (pc.connectionState !== 'closed') {
        pc.close();
      }
      // Only stop voice if there's an active stream
      if (localStreamRef.current) {
        stopVoiceChat();
      }
    };
  }, [config.roomId, config.peerId]);

  return {
    isConnected,
    connectionState,
    connectionMode,
    connectionDetails,
    remoteStream,
    sendMessage,
    sendFile,
    startVoiceChat,
    stopVoiceChat,
    isNCEnabled,
    peerNCEnabled,
  };
}
