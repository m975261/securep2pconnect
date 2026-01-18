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
    
    const pc = new RTCPeerConnection({
      iceServers: [{
        urls: turnConfig.urls,
        username: turnConfig.username,
        credential: turnConfig.credential,
      }],
      iceTransportPolicy: 'relay',
    });
    
    pc.createDataChannel('test');
    
    const timeout = setTimeout(() => {
      if (!completed) {
        completed = true;
        pc.close();
        resolve({
          success: candidates.length > 0,
          candidates,
          error: candidates.length === 0 ? 'Timeout: No relay candidates.' : undefined
        });
      }
    }, 15000);
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        candidates.push({
          type: event.candidate.type || 'unknown',
          protocol: event.candidate.protocol || 'unknown',
          address: event.candidate.address || 'hidden'
        });
      }
    };
    
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete' && !completed) {
        completed = true;
        clearTimeout(timeout);
        pc.close();
        resolve({
          success: candidates.length > 0,
          candidates,
          error: candidates.length === 0 ? 'No relay candidates generated.' : undefined
        });
      }
    };
    
    pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(err => {
      if (!completed) {
        completed = true;
        clearTimeout(timeout);
        pc.close();
        resolve({ success: false, candidates: [], error: err.message });
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
export type PeerRole = 'controller' | 'follower' | null;

export interface ConnectionDetails {
  mode: ConnectionMode;
  localIP?: string;
  remoteIP?: string;
  localPort?: number;
  remotePort?: number;
  protocol?: string;
  turnServerIP?: string;
}

// Extract TURN server hostname from URL
function extractTurnServerHost(urls: string[]): string | undefined {
  for (const url of urls) {
    const match = url.match(/turns?:\/?\/?([^:/?]+)/);
    if (match && match[1]) return match[1];
  }
  return undefined;
}

/**
 * Clean WebRTC State Machine
 * 
 * RULES:
 * 1. Server assigns immutable roles: controller or follower
 * 2. Only controller can: detect mode, trigger fallback, broadcast mode
 * 3. Follower only receives and displays mode from controller
 * 4. Mode is frozen immediately once determined
 * 5. No polling, no re-evaluation after mode is set
 */
export function useWebRTC(config: WebRTCConfig) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('pending');
  const [connectionDetails, setConnectionDetails] = useState<ConnectionDetails>({ mode: 'pending' });
  const [isNCEnabled, setIsNCEnabled] = useState(false);
  const [peerNCEnabled, setPeerNCEnabled] = useState(false);
  
  // Refs for WebRTC state
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const rawStreamRef = useRef<MediaStream | null>(null);
  const noiseSuppressedPipelineRef = useRef<NoiseSuppressedStream | null>(null);
  
  // Session ID - generated fresh on every page load, used to filter stale events
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  // Remote peer's sessionId - stored when they join, used to validate their messages
  const remotePeerSessionIdRef = useRef<string | null>(null);
  
  // Role and mode state (immutable once set)
  const roleRef = useRef<PeerRole>(null);
  const modeLockedRef = useRef(false);
  const fallbackTriggeredRef = useRef(false);
  const connectionEstablishedRef = useRef(false);
  
  // File transfer state
  const fileMetadataRef = useRef<any>(null);
  const fileChunksRef = useRef<ArrayBuffer[]>([]);
  
  // Negotiation state
  const negotiatingRef = useRef(false);
  const pendingNegotiationRef = useRef(false);
  const pendingStopRef = useRef(false);
  
  // Pending mode (if received before role assignment)
  const pendingModeRef = useRef<ConnectionMode | null>(null);
  
  // ICE servers config ref (for rebuilding PC)
  const iceServersRef = useRef<RTCConfiguration['iceServers']>([]);
  
  // Pending remote ICE candidates (shared across handlers)
  const pendingRemoteIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  
  // Grace window for disconnected state (controller only)
  const disconnectedSinceRef = useRef<number | null>(null);
  const disconnectedTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Mode detection retry timer (cleared on hard reset)
  const modeDetectionRetryRef = useRef<NodeJS.Timeout | null>(null);
  
  
  // Config ref for callbacks
  const configRef = useRef(config);
  useEffect(() => { configRef.current = config; });

  // Helper: attach ALL event handlers to a PeerConnection (unified for initial and relay PC)
  // pendingCandidates: optional array for buffering candidates before WS is open (initial PC only)
  const attachPeerConnectionHandlers = useCallback((
    pc: RTCPeerConnection, 
    createRelayConnectionFn: () => void, 
    detectAndLockModeFn: () => void,
    pendingCandidates?: RTCIceCandidate[]
  ) => {
    console.log('[WebRTC] attachPeerConnectionHandlers called');
    
    // Transport-level mode detection via candidate-pair stats (controller only)
    let modeDetectionInProgress = false;
    const tryDetectModeFromStats = async () => {
      if (modeLockedRef.current || modeDetectionInProgress) return;
      if (roleRef.current !== 'controller') return;
      
      modeDetectionInProgress = true;
      try {
        const currentPc = pcRef.current;
        if (!currentPc) return;
        
        const stats = await currentPc.getStats();
        stats.forEach((report: any) => {
          if (
            report.type === 'candidate-pair' &&
            report.nominated === true &&
            report.state === 'succeeded'
          ) {
            console.log('[MODE] candidate-pair succeeded — detecting mode');
            detectAndLockModeFn();
          }
        });
      } finally {
        modeDetectionInProgress = false;
      }
    };
    
    // ICE candidate handler with grace window reset
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // Log candidate type for diagnostics
        console.log('[ICE-CANDIDATE]', event.candidate.type, event.candidate.protocol, event.candidate.address);
        
        // ICE activity detected - reset grace window if active
        if (disconnectedSinceRef.current) {
          console.log('[ICE] candidate received - resetting grace window');
          disconnectedSinceRef.current = Date.now();
        }
        
        // Try transport-level mode detection (controller only)
        tryDetectModeFromStats();
        
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ice-candidate', data: event.candidate, sessionId: sessionIdRef.current }));
        } else if (pendingCandidates) {
          // Buffer for later (initial PC only, before WS is open)
          pendingCandidates.push(event.candidate);
        }
      }
    };
    
    // ICE gathering state changes reset grace window
    pc.onicegatheringstatechange = () => {
      console.log('[ICE-Gathering]', pc.iceGatheringState);
      if (disconnectedSinceRef.current && pc.iceGatheringState !== 'complete') {
        console.log('[ICE] gathering state changed - resetting grace window');
        disconnectedSinceRef.current = Date.now();
      }
    };
    
    // Full ICE connection state machine
    // No post-lock ignore - refresh = new session
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      const disconnectedSince = disconnectedSinceRef.current;
      console.log('[ICE-TRACE]', {
        state,
        role: roleRef.current,
        modeLocked: modeLockedRef.current,
        fallbackTriggered: fallbackTriggeredRef.current,
        disconnectedSince: disconnectedSince ? Date.now() - disconnectedSince : null
      });
      
      // Try transport-level mode detection (controller only)
      tryDetectModeFromStats();

      // Success → detect mode, clear grace timer, mark connection established
      if (state === 'connected' || state === 'completed') {
        connectionEstablishedRef.current = true;
        disconnectedSinceRef.current = null;
        if (disconnectedTimerRef.current) {
          clearInterval(disconnectedTimerRef.current);
          disconnectedTimerRef.current = null;
        }
        if (roleRef.current === 'controller' && !modeLockedRef.current) {
          detectAndLockModeFn();
        }
        return;
      }

      // Hard failure → immediate fallback (ONLY during initial connection, pre-lock)
      if (state === 'failed') {
        // After mode lock: no recovery, session ends via peer-left
        if (modeLockedRef.current || connectionEstablishedRef.current) {
          console.log('[ICE] failed post-lock - no recovery, session will end');
          return;
        }
        // Relay is final - no more fallback logic
        if (fallbackTriggeredRef.current) {
          console.log('[ICE] failed during relay - relay is final, no action');
          return;
        }
        console.log('[WebRTC] iceConnectionState=failed - immediate fallback (initial connection)');
        disconnectedSinceRef.current = null;
        if (disconnectedTimerRef.current) {
          clearInterval(disconnectedTimerRef.current);
          disconnectedTimerRef.current = null;
        }
        if (roleRef.current === 'controller') {
          createRelayConnectionFn();
        }
        return;
      }

      // Soft failure → grace timer (ONLY during initial connection, pre-lock)
      if (state === 'disconnected') {
        // After mode lock: no recovery, session ends via peer-left
        if (modeLockedRef.current || connectionEstablishedRef.current) {
          console.log('[ICE] disconnected post-lock - no recovery, session will end');
          return;
        }
        // Relay is final - no grace timers after fallback
        if (fallbackTriggeredRef.current) {
          disconnectedSinceRef.current = null;
          console.log('[ICE] disconnected during relay - relay is final, ignoring');
          return;
        }
        if (disconnectedSinceRef.current) {
          console.log('[ICE] disconnected event received - resetting grace window (initial connection)');
        } else {
          console.log('[ICE] disconnected - starting 12s grace window (initial connection)');
        }
        disconnectedSinceRef.current = Date.now();
        
        if (!disconnectedTimerRef.current) {
          disconnectedTimerRef.current = setInterval(() => {
            // After mode lock: no recovery
            if (modeLockedRef.current || connectionEstablishedRef.current) {
              if (disconnectedTimerRef.current) {
                clearInterval(disconnectedTimerRef.current);
                disconnectedTimerRef.current = null;
              }
              disconnectedSinceRef.current = null;
              return;
            }
            // Double-check relay status in timer callback
            if (fallbackTriggeredRef.current) {
              if (disconnectedTimerRef.current) {
                clearInterval(disconnectedTimerRef.current);
                disconnectedTimerRef.current = null;
              }
              disconnectedSinceRef.current = null;
              return;
            }
            const since = disconnectedSinceRef.current;
            if (since && Date.now() - since > 12000) {
              console.log('[ICE] disconnected too long (12s) → fallback to relay (initial connection)');
              if (disconnectedTimerRef.current) {
                clearInterval(disconnectedTimerRef.current);
                disconnectedTimerRef.current = null;
              }
              disconnectedSinceRef.current = null;
              if (roleRef.current === 'controller') {
                createRelayConnectionFn();
              }
            }
          }, 2000);
        }
        return;
      }

      // Other states (checking, new, closed) → clear grace timer
      disconnectedSinceRef.current = null;
      if (disconnectedTimerRef.current) {
        clearInterval(disconnectedTimerRef.current);
        disconnectedTimerRef.current = null;
      }
    };

    // connectionState for logging/backup mode detection only
    pc.onconnectionstatechange = () => {
      // Relay is final - completely ignore connectionState during relay
      if (fallbackTriggeredRef.current) {
        console.log('[WebRTC] connectionState ignored during relay:', pc.connectionState);
        return;
      }
      console.log('[Connection]', pc.connectionState);
      
      if (pc.connectionState === 'connected') {
        if (roleRef.current === 'controller' && !modeLockedRef.current) {
          detectAndLockModeFn();
        }
      }
    };
    
    // Track handler
    pc.ontrack = (event) => {
      if (event.streams?.[0]) {
        setRemoteStream(event.streams[0]);
        configRef.current.onRemoteStream?.(event.streams[0]);
      }
    };
  }, []);

  // Helper: rebuild RTCPeerConnection with clean state
  // INVARIANT: Every RTCPeerConnection must have handlers attached exactly once
  // This function ALWAYS attaches handlers internally - callers should NOT call attachPeerConnectionHandlers separately
  const rebuildPeerConnection = useCallback((
    iceTransportPolicy: 'all' | 'relay' = 'all',
    createRelayConnectionFn?: () => void,
    detectAndLockModeFn?: () => void
  ) => {
    // Close existing connection (removes all listeners)
    pcRef.current?.close();
    
    // Reset negotiation state (but NOT pending ICE candidates - they'll be flushed after remote description)
    negotiatingRef.current = false;
    pendingNegotiationRef.current = false;
    // Clear pending ICE candidates - refresh = new session, no state preservation
    pendingRemoteIceCandidatesRef.current = [];
    
    // Build ICE servers
    const iceServers = iceTransportPolicy === 'relay' && configRef.current.turnConfig
      ? [{ urls: configRef.current.turnConfig.urls, username: configRef.current.turnConfig.username, credential: configRef.current.turnConfig.credential }]
      : iceServersRef.current;
    
    // Log iceServers config for debugging
    console.log('[ICE-CONFIG] rebuildPeerConnection', {
      iceTransportPolicy,
      iceServersCount: iceServers?.length || 0,
      iceServers: iceServers?.map(s => ({ urls: s.urls, hasUsername: !!s.username, hasCredential: !!s.credential })) || []
    });
    
    // Create new peer connection
    const newPc = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy,
      iceCandidatePoolSize: 10,
    });
    pcRef.current = newPc;
    
    // Setup data channel
    const dataChannel = newPc.createDataChannel('connection-init', { negotiated: true, id: 0 });
    dataChannel.onopen = () => {
      console.log('[DataChannel] opened');
    };
    
    // Re-add local stream tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => newPc.addTrack(track, localStreamRef.current!));
    }
    
    // ALWAYS attach handlers - this is the invariant
    // Use no-op functions if not provided (e.g., during hard reset waiting for new peer)
    attachPeerConnectionHandlers(
      newPc,
      createRelayConnectionFn || (() => {}),
      detectAndLockModeFn || (() => {})
    );
    
    return newPc;
  }, [attachPeerConnectionHandlers]);

  // Flush buffered remote ICE candidates into current PC
  // This is the ONLY place that clears the buffer
  const flushPendingRemoteCandidates = useCallback(() => {
    const pc = pcRef.current;
    const candidates = pendingRemoteIceCandidatesRef.current;
    
    if (!pc || candidates.length === 0) return;
    
    console.log('[ICE-REMOTE] flushing', candidates.length, 'candidates');
    for (const c of candidates) {
      const candidate = new RTCIceCandidate(c);
      console.log('[ICE-REMOTE] addIceCandidate (flush)', candidate.type, candidate.protocol);
      pc.addIceCandidate(candidate).catch(console.error);
    }
    
    // Clear buffer ONLY here, after candidates are applied
    pendingRemoteIceCandidatesRef.current = [];
  }, []);

  // Lock mode permanently (called only by controller or when receiving from controller)
  const lockMode = useCallback((mode: ConnectionMode, details: ConnectionDetails) => {
    if (modeLockedRef.current) return;
    
    console.log('[WebRTC] LOCKING mode:', mode, 'role:', roleRef.current);
    modeLockedRef.current = true;
    setConnectionMode(mode);
    setConnectionDetails(details);
    
    // Only controller broadcasts mode
    if (roleRef.current === 'controller') {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'connection-mode', mode, sessionId: sessionIdRef.current }));
        console.log('[WebRTC] Controller broadcasted mode:', mode);
      }
    }
  }, []);

  // Controller-only: detect mode from stats (single shot)
  const detectAndLockMode = useCallback(() => {
    console.log('[MODE] detectAndLockMode CALLED', { role: roleRef.current, modeLocked: modeLockedRef.current });
    
    if (roleRef.current !== 'controller') {
      console.log('[MODE] not controller — exiting');
      return;
    }
    if (modeLockedRef.current) {
      console.log('[MODE] already locked — exiting');
      return;
    }
    
    const pc = pcRef.current;
    if (!pc || pc.connectionState === 'closed') {
      console.log('[MODE] no PC or closed — exiting');
      return;
    }
    
    console.log('[MODE] calling getStats');
    pc.getStats().then(stats => {
      if (modeLockedRef.current) {
        console.log('[MODE] mode locked during getStats — exiting');
        return;
      }
      
      const statsArray = Array.from(stats.values());
      const candidatePairs = statsArray.filter((r: any) => r.type === 'candidate-pair');
      
      const selectedPair = candidatePairs.find((r: any) => r.selected === true) ||
                           candidatePairs.find((r: any) => r.state === 'succeeded' && r.nominated) ||
                           candidatePairs.find((r: any) => r.state === 'succeeded');
      
      if (!selectedPair) {
        console.log('[MODE] no selected pair yet — scheduling retry');
        // Schedule bounded retry (300ms) - cleared on hard reset
        // Capture current PC to guard against stale timer firing after reset
        const currentPc = pcRef.current;
        if (!modeDetectionRetryRef.current) {
          modeDetectionRetryRef.current = setTimeout(() => {
            modeDetectionRetryRef.current = null;
            // Guard: only retry if PC is still the same (no reset occurred)
            if (pcRef.current !== currentPc || pcRef.current?.connectionState === 'closed') {
              console.log('[MODE] stale retry — PC changed, skipping');
              return;
            }
            detectAndLockMode();
          }, 300);
        }
        return;
      }
      
      const localCandidate = statsArray.find((s: any) => s.id === selectedPair.localCandidateId);
      const remoteCandidate = statsArray.find((s: any) => s.id === selectedPair.remoteCandidateId);
      
      const isRelay = localCandidate?.candidateType === 'relay' || remoteCandidate?.candidateType === 'relay';
      const detectedMode: ConnectionMode = isRelay ? 'turn' : 'p2p';
      
      console.log('[MODE] detected mode =', detectedMode, { localType: localCandidate?.candidateType, remoteType: remoteCandidate?.candidateType });
      console.log('[MODE] broadcasting and locking mode');
      
      lockMode(detectedMode, {
        mode: detectedMode,
        remoteIP: remoteCandidate?.address,
        protocol: localCandidate?.protocol,
        turnServerIP: isRelay ? extractTurnServerHost(configRef.current.turnConfig?.urls || []) : undefined
      });
      
      console.log('[MODE] mode locked');
    }).catch(err => console.warn('[WebRTC] Stats error:', err));
  }, [lockMode]);

  // Controller-only: create relay-only connection for TURN fallback
  const createRelayConnection = useCallback(() => {
    const pc = pcRef.current;
    console.log('[RELAY] createRelayConnection CALLED', {
      role: roleRef.current,
      modeLocked: modeLockedRef.current,
      fallbackTriggered: fallbackTriggeredRef.current,
      iceState: pc?.iceConnectionState,
      connectionState: pc?.connectionState
    });
    
    if (roleRef.current !== 'controller' || modeLockedRef.current || fallbackTriggeredRef.current) {
      console.log('[RELAY] guard failed — exiting');
      return;
    }
    
    fallbackTriggeredRef.current = true;
    const turnConfig = configRef.current.turnConfig;
    if (!turnConfig) {
      console.error('[WebRTC] No TURN config for fallback');
      return;
    }
    
    // Log full TURN config for debugging (credentials masked)
    console.log('[RELAY] TURN config for fallback:', {
      urls: turnConfig.urls,
      username: turnConfig.username ? `${turnConfig.username.substring(0, 4)}...` : 'MISSING',
      hasCredential: !!turnConfig.credential,
      credentialLength: turnConfig.credential?.length || 0
    });
    
    console.log('[WebRTC] Creating relay-only connection');
    // Note: Do NOT set 'reconnecting' here - relay fallback is still part of initial connection attempt
    // UI stays in 'pending' (connecting) state until mode is detected
    
    // Notify follower to prepare for relay restart
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'relay-restart' }));
    }
    
    // Rebuild PC with relay-only policy (handlers attached internally)
    // Pass no-op for createRelayConnection since fallback is already triggered
    rebuildPeerConnection('relay', () => {}, detectAndLockMode);
    flushPendingRemoteCandidates();
    console.log('[RELAY] handlers attached to relay PeerConnection');
    
    // Create and send offer using the rebuilt PC
    const relayPc = pcRef.current;
    if (ws?.readyState === WebSocket.OPEN && relayPc) {
      relayPc.createOffer().then((offer: RTCSessionDescriptionInit) => relayPc.setLocalDescription(offer))
        .then(() => {
          ws.send(JSON.stringify({ type: 'offer', data: relayPc.localDescription, sessionId: sessionIdRef.current }));
          console.log('[Relay] Offer sent');
        }).catch((err: Error) => console.error('[Relay] Error:', err));
    }
  }, [lockMode, rebuildPeerConnection, detectAndLockMode, flushPendingRemoteCandidates]);

  const sendMessage = useCallback((message: any) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'chat',
        data: { ...message, from: configRef.current.peerId, fromNickname: configRef.current.nickname },
        sessionId: sessionIdRef.current,
      }));
    }
  }, []);

  // Explicitly end session (broadcasts session-end to all peers)
  const endSession = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'end-session' }));
    }
  }, []);

  const sendFile = useCallback((file: File, options?: SendFileOptions) => {
    return new Promise<void>((resolve, reject) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const reader = new FileReader();
      reader.onload = async () => {
        const arrayBuffer = reader.result as ArrayBuffer;
        
        ws.send(JSON.stringify({
          type: 'file-metadata',
          data: { name: file.name, size: file.size, type: file.type, from: configRef.current.peerId, fromNickname: configRef.current.nickname },
          sessionId: sessionIdRef.current,
        }));
        
        const chunkSize = 16384;
        const totalChunks = Math.ceil(arrayBuffer.byteLength / chunkSize);
        let chunksSent = 0;
        
        for (let offset = 0; offset < arrayBuffer.byteLength; offset += chunkSize) {
          if (ws.readyState !== WebSocket.OPEN) {
            reject(new Error('Connection lost'));
            return;
          }
          
          const chunk = arrayBuffer.slice(offset, offset + chunkSize);
          const bytes = new Uint8Array(chunk);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          ws.send(JSON.stringify({ type: 'file-chunk', data: btoa(binary), sessionId: sessionIdRef.current }));
          
          chunksSent++;
          options?.onProgress?.(Math.round((chunksSent / totalChunks) * 100));
          await new Promise(r => setTimeout(r, 0));
        }
        
        ws.send(JSON.stringify({ type: 'file-eof', data: null, sessionId: sessionIdRef.current }));
        resolve();
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }, []);

  const sendNCStatus = useCallback((enabled: boolean) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'nc-status', data: { enabled }, sessionId: sessionIdRef.current }));
    }
  }, []);

  const startVoiceChat = useCallback(async () => {
    try {
      const rawStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      rawStreamRef.current = rawStream;
      
      let streamToUse: MediaStream;
      let ncEnabled = false;
      
      if (isNoiseCancellationSupported()) {
        try {
          const pipeline = await createNoiseSuppressedStream(rawStream);
          noiseSuppressedPipelineRef.current = pipeline;
          streamToUse = pipeline.stream;
          ncEnabled = pipeline.isNoiseCancellationEnabled;
        } catch {
          streamToUse = rawStream;
        }
      } else {
        streamToUse = rawStream;
      }
      
      localStreamRef.current = streamToUse;
      setIsNCEnabled(ncEnabled);
      sendNCStatus(ncEnabled);
      
      const pc = pcRef.current;
      if (pc) {
        streamToUse.getTracks().forEach(track => pc.addTrack(track, streamToUse));
        
        if (pc.signalingState === 'stable' && !negotiatingRef.current) {
          negotiatingRef.current = true;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          wsRef.current?.send(JSON.stringify({ type: 'offer', data: offer, sessionId: sessionIdRef.current }));
        }
      }
    } catch (error) {
      console.error('[VoiceChat] Error:', error);
      throw error;
    }
  }, [sendNCStatus]);

  const stopVoiceChat = useCallback(() => {
    if (negotiatingRef.current) {
      pendingStopRef.current = true;
      return;
    }
    
    noiseSuppressedPipelineRef.current?.cleanup();
    noiseSuppressedPipelineRef.current = null;
    
    rawStreamRef.current?.getTracks().forEach(t => t.stop());
    rawStreamRef.current = null;
    
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    
    setIsNCEnabled(false);
    sendNCStatus(false);
  }, [sendNCStatus]);

  // Main effect: WebSocket and PeerConnection setup
  useEffect(() => {
    if (!config.roomId || !config.peerId) return;

    // HARD RESET: Clear ALL state for completely fresh session
    // Refresh = new session, always
    // Generate new sessionId for this session
    sessionIdRef.current = crypto.randomUUID();
    remotePeerSessionIdRef.current = null;
    console.log('[WebRTC] New session started:', sessionIdRef.current.slice(0, 8));
    
    roleRef.current = null;
    modeLockedRef.current = false;
    fallbackTriggeredRef.current = false;
    connectionEstablishedRef.current = false;
    pendingModeRef.current = null;
    disconnectedSinceRef.current = null;
    
    // Clear any stale timers
    if (modeDetectionRetryRef.current) {
      clearTimeout(modeDetectionRetryRef.current);
      modeDetectionRetryRef.current = null;
    }
    if (disconnectedTimerRef.current) {
      clearInterval(disconnectedTimerRef.current);
      disconnectedTimerRef.current = null;
    }
    
    // Clear pending ICE candidates (fresh session, no state preservation)
    pendingRemoteIceCandidatesRef.current = [];
    
    setConnectionMode('pending');
    setConnectionDetails({ mode: 'pending' });

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    // Build ICE servers and store in ref for rebuild helper
    const iceServers: RTCConfiguration['iceServers'] = [];
    if (config.turnConfig?.stunUrls?.length) {
      iceServers.push({ urls: config.turnConfig.stunUrls });
    }
    if (config.turnConfig) {
      iceServers.push({
        urls: config.turnConfig.urls,
        username: config.turnConfig.username,
        credential: config.turnConfig.credential,
      });
    }
    iceServersRef.current = iceServers;

    // Create PeerConnection with P2P-first strategy
    const pc = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy: 'all',
      iceCandidatePoolSize: 10,
    });
    pcRef.current = pc;

    const dataChannel = pc.createDataChannel('connection-init', { negotiated: true, id: 0 });
    dataChannel.onopen = () => {
      console.log('[DataChannel] opened');
    };

    // Buffer for ICE candidates before WS is open
    const pendingIceCandidates: RTCIceCandidate[] = [];

    // Attach unified handlers (single source of truth for ICE state machine)
    attachPeerConnectionHandlers(pc, createRelayConnection, detectAndLockMode, pendingIceCandidates);
    
    // Flush any pending remote candidates (from previous session or early arrivals)
    flushPendingRemoteCandidates();

    // Heartbeat interval reference - cleared on cleanup
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    const heartbeatSessionId = sessionIdRef.current; // Capture session for closure
    
    ws.onopen = () => {
      console.log('[WS] Connected, joining room');
      ws.send(JSON.stringify({
        type: 'join',
        roomId: config.roomId,
        peerId: config.peerId,
        nickname: config.nickname,
        sessionId: sessionIdRef.current,
      }));

      // Flush pending ICE candidates
      pendingIceCandidates.forEach(c => ws.send(JSON.stringify({ type: 'ice-candidate', data: c, sessionId: sessionIdRef.current })));
      pendingIceCandidates.length = 0;
      
      // Start heartbeat - sends ping every 20 seconds to keep connection alive
      // Stops if: WS closes, session changes, or cleanup runs
      heartbeatInterval = setInterval(() => {
        // Stop if session changed (refresh = new session)
        if (sessionIdRef.current !== heartbeatSessionId) {
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          return;
        }
        // Only send if WS is open
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        } else {
          if (heartbeatInterval) clearInterval(heartbeatInterval);
        }
      }, 20000);
    };

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        const myPeerId = config.peerId;
        
        // === SESSION SCOPING ===
        // 1. Stale SELF events: ignore peer-left/joined about MY peerId with OLD sessionId
        //    (handles refresh: old session's peer-left arrives at new session)
        const isSelfEvent = message.peerId === myPeerId;
        if (isSelfEvent && message.sessionId && message.sessionId !== sessionIdRef.current) {
          console.log('[WebRTC] Ignoring stale self-event:', message.type, message.sessionId?.slice(0, 8));
          return;
        }
        
        // 2. Stale REMOTE events: ignore events from remote peer with OLD sessionId
        //    (handles remote refresh: old session's signaling arrives after they rejoin)
        const isRemoteEvent = message.from && message.from !== myPeerId;
        if (isRemoteEvent && remotePeerSessionIdRef.current && message.sessionId && 
            message.sessionId !== remotePeerSessionIdRef.current) {
          console.log('[WebRTC] Ignoring stale remote event:', message.type, message.sessionId?.slice(0, 8));
          return;
        }

        if (message.type === 'joined') {
          // SERVER ASSIGNED ROLE - immutable
          roleRef.current = message.role;
          console.log('[WebRTC] Role assigned by server:', message.role);
          
          setIsConnected(true);
          setConnectionState('connected');
          
          // Check if there's a pending mode to apply now that role is set
          if (pendingModeRef.current && roleRef.current === 'follower' && !modeLockedRef.current) {
            console.log('[WebRTC] Applying pending mode after role assignment:', pendingModeRef.current);
            lockMode(pendingModeRef.current, { mode: pendingModeRef.current });
            pendingModeRef.current = null;
          }
          
          // If there's already a peer (we're the second to join)
          if (message.existingPeers?.length > 0) {
            const existingPeer = message.existingPeers[0];
            configRef.current.onPeerConnected?.({ nickname: existingPeer?.nickname });
            
            // Store existing peer's sessionId if available (for session scoping)
            if (existingPeer?.sessionId) {
              remotePeerSessionIdRef.current = existingPeer.sessionId;
              console.log('[WebRTC] Stored existing peer sessionId:', existingPeer.sessionId.slice(0, 8));
            }
            
            // Controller (first peer, room creator) waits for follower's offer
            // Follower (joiner) creates and sends offer
            if (roleRef.current === 'follower') {
              console.log('[Follower] Creating initial offer');
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              ws.send(JSON.stringify({ type: 'offer', data: offer, sessionId: sessionIdRef.current }));
            }
          }
        } else if (message.type === 'role-update') {
          // Role promotion (when peer left and we become controller)
          const oldRole = roleRef.current;
          roleRef.current = message.role;
          console.log('[WebRTC] Role updated from', oldRole, 'to:', message.role);
          
          // Check if there's a pending mode to apply now that we have a role
          if (pendingModeRef.current && roleRef.current === 'follower' && !modeLockedRef.current) {
            console.log('[WebRTC] Applying pending mode:', pendingModeRef.current);
            lockMode(pendingModeRef.current, { mode: pendingModeRef.current });
            pendingModeRef.current = null;
          }
        } else if (message.type === 'peer-joined') {
          console.log('[WebRTC] Peer joined:', message.nickname);
          // Store remote peer's sessionId for future validation
          if (message.sessionId) {
            remotePeerSessionIdRef.current = message.sessionId;
            console.log('[WebRTC] Stored remote peer sessionId:', message.sessionId.slice(0, 8));
          }
          setIsConnected(true);
          setConnectionState('connected');
          configRef.current.onPeerConnected?.({ nickname: message.nickname });
        } else if (message.type === 'offer') {
          const currentPc = pcRef.current;
          if (!currentPc) {
            console.warn('[WebRTC] Received offer but no PC exists');
            return;
          }
          console.log('[WebRTC] Received offer');
          await currentPc.setRemoteDescription(new RTCSessionDescription(message.data));
          
          const answer = await currentPc.createAnswer();
          await currentPc.setLocalDescription(answer);
          ws.send(JSON.stringify({ type: 'answer', data: answer, sessionId: sessionIdRef.current }));
          console.log('[WebRTC] Answer sent');
        } else if (message.type === 'answer') {
          const currentPc = pcRef.current;
          if (!currentPc) {
            console.warn('[WebRTC] Received answer but no PC exists');
            return;
          }
          if (currentPc.signalingState === 'have-local-offer') {
            await currentPc.setRemoteDescription(new RTCSessionDescription(message.data));
            negotiatingRef.current = false;
            
            if (pendingStopRef.current) {
              pendingStopRef.current = false;
              setTimeout(() => stopVoiceChat(), 100);
            } else if (pendingNegotiationRef.current) {
              pendingNegotiationRef.current = false;
            }
          }
        } else if (message.type === 'ice-candidate') {
          if (message.data) {
            const currentPc = pcRef.current;
            // Always add if PC exists, else buffer
            if (currentPc) {
              const candidate = new RTCIceCandidate(message.data);
              console.log('[ICE-REMOTE] addIceCandidate', candidate.type, candidate.protocol);
              currentPc.addIceCandidate(candidate).catch(console.error);
            } else {
              pendingRemoteIceCandidatesRef.current.push(message.data);
            }
          }
        } else if (message.type === 'relay-restart') {
          // Controller is restarting with relay - follower prepares for new offer
          console.log('[Follower] Relay restart from controller');
          if (roleRef.current === 'follower') {
            // Note: Do NOT set 'reconnecting' - relay fallback is still part of initial connection
            // UI stays in 'pending' until mode is detected from controller
            // NOTE: Do NOT clear buffer - flush happens after PC creation
            // Rebuild PC with relay policy to match controller (handlers attached internally)
            rebuildPeerConnection('relay', () => {}, detectAndLockMode);
            flushPendingRemoteCandidates();
            console.log('[Follower] Rebuilt relay PC, handlers attached, candidates flushed');
          }
        } else if (message.type === 'connection-mode') {
          // Follower receives mode from controller
          if (roleRef.current === 'follower' && !modeLockedRef.current) {
            console.log('[Follower] Received mode from controller:', message.mode);
            lockMode(message.mode, { mode: message.mode });
          } else if (roleRef.current === null) {
            // Role not yet assigned, queue the mode for later
            console.log('[WebRTC] Mode received before role, queuing:', message.mode);
            pendingModeRef.current = message.mode;
          }
        } else if (message.type === 'chat') {
          configRef.current.onMessage?.(message.data);
        } else if (message.type === 'file-metadata') {
          fileMetadataRef.current = message.data;
          fileChunksRef.current = [];
        } else if (message.type === 'file-chunk') {
          const binaryString = atob(message.data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
          fileChunksRef.current.push(bytes.buffer);
        } else if (message.type === 'file-eof') {
          if (fileMetadataRef.current) {
            const metadata = fileMetadataRef.current;
            const blob = new Blob(fileChunksRef.current, { type: metadata.type });
            const reader = new FileReader();
            reader.onload = () => {
              configRef.current.onFileReceive?.({
                name: metadata.name,
                type: metadata.type,
                size: metadata.size,
                data: reader.result as ArrayBuffer,
                from: metadata.from,
                fromNickname: metadata.fromNickname,
              });
            };
            reader.readAsArrayBuffer(blob);
            fileChunksRef.current = [];
            fileMetadataRef.current = null;
          }
        } else if (message.type === 'nc-status') {
          setPeerNCEnabled(message.data?.enabled ?? false);
          configRef.current.onPeerNCStatusChange?.(message.data?.enabled ?? false);
        } else if (message.type === 'peer-left') {
          // peer-left = HARD RESET
          // Refresh/network change = new session
          // Both peers must start fresh
          console.log('[WebRTC] peer-left → hard reset (new session)');
          
          // Clear all timers
          if (modeDetectionRetryRef.current) {
            clearTimeout(modeDetectionRetryRef.current);
            modeDetectionRetryRef.current = null;
          }
          if (disconnectedTimerRef.current) {
            clearInterval(disconnectedTimerRef.current);
            disconnectedTimerRef.current = null;
          }
          
          // Full state reset
          setIsConnected(false);
          setConnectionState('disconnected');
          setRemoteStream(null);
          setPeerNCEnabled(false);
          modeLockedRef.current = false;
          fallbackTriggeredRef.current = false;
          connectionEstablishedRef.current = false;
          pendingModeRef.current = null;
          remotePeerSessionIdRef.current = null; // Clear for next peer
          disconnectedSinceRef.current = null;
          setConnectionMode('pending');
          setConnectionDetails({ mode: 'pending' });
          
          // New PC for new session (handlers attached internally)
          rebuildPeerConnection('all', createRelayConnection, detectAndLockMode);
          
          configRef.current.onRemoteStream?.(null);
          configRef.current.onPeerDisconnected?.();
        } else if (message.type === 'session-end') {
          // session-end = explicit room close, HARD RESET
          console.log('[WebRTC] session-end → hard reset');
          
          // Clear all timers
          if (modeDetectionRetryRef.current) {
            clearTimeout(modeDetectionRetryRef.current);
            modeDetectionRetryRef.current = null;
          }
          if (disconnectedTimerRef.current) {
            clearInterval(disconnectedTimerRef.current);
            disconnectedTimerRef.current = null;
          }
          
          // Full reset
          setIsConnected(false);
          setConnectionState('disconnected');
          setRemoteStream(null);
          setPeerNCEnabled(false);
          modeLockedRef.current = false;
          fallbackTriggeredRef.current = false;
          connectionEstablishedRef.current = false;
          pendingModeRef.current = null;
          disconnectedSinceRef.current = null;
          setConnectionMode('pending');
          setConnectionDetails({ mode: 'pending' });
          
          // New PC for new session (handlers attached internally)
          rebuildPeerConnection('all', createRelayConnection, detectAndLockMode);
          
          configRef.current.onRemoteStream?.(null);
          configRef.current.onPeerDisconnected?.();
        }
      } catch (error) {
        console.error('[WS] Message error:', error);
      }
    };

    ws.onclose = () => {
      console.log('[WS] Closed');
      // Clear heartbeat on WS close
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      setConnectionState('disconnected');
    };

    // Cleanup on unmount
    return () => {
      console.log('[WebRTC] Cleanup');
      
      // Clear heartbeat interval
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      
      // Clear grace window timer
      if (disconnectedTimerRef.current) {
        clearInterval(disconnectedTimerRef.current);
        disconnectedTimerRef.current = null;
      }
      
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      
      if (pc.connectionState !== 'closed') {
        pc.close();
      }
      
      if (localStreamRef.current) {
        stopVoiceChat();
      }
    };
  }, [config.roomId, config.peerId, detectAndLockMode, createRelayConnection, lockMode, rebuildPeerConnection, stopVoiceChat, attachPeerConnectionHandlers, flushPendingRemoteCandidates]);

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
    endSession,
  };
}
