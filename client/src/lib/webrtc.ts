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
  
  // Role and mode state (immutable once set)
  const roleRef = useRef<PeerRole>(null);
  const modeLockedRef = useRef(false);
  const fallbackTimerRef = useRef<NodeJS.Timeout | null>(null);
  const fallbackTriggeredRef = useRef(false);
  
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
  
  // Config ref for callbacks
  const configRef = useRef(config);
  useEffect(() => { configRef.current = config; });

  // Helper: rebuild RTCPeerConnection with clean state
  const rebuildPeerConnection = useCallback((iceTransportPolicy: 'all' | 'relay' = 'all') => {
    // Clear any active timers first
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    
    // Close existing connection (removes all listeners)
    pcRef.current?.close();
    
    // Reset all negotiation state
    negotiatingRef.current = false;
    pendingNegotiationRef.current = false;
    pendingRemoteIceCandidatesRef.current = [];
    
    // Build ICE servers
    const iceServers = iceTransportPolicy === 'relay' && configRef.current.turnConfig
      ? [{ urls: configRef.current.turnConfig.urls, username: configRef.current.turnConfig.username, credential: configRef.current.turnConfig.credential }]
      : iceServersRef.current;
    
    // Create new peer connection
    const newPc = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy,
      iceCandidatePoolSize: 10,
    });
    pcRef.current = newPc;
    
    // Setup data channel
    newPc.createDataChannel('connection-init', { negotiated: true, id: 0 });
    
    // Re-add local stream tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => newPc.addTrack(track, localStreamRef.current!));
    }
    
    // Setup ICE candidate handler
    newPc.onicecandidate = (event) => {
      if (event.candidate) {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ice-candidate', data: event.candidate }));
        }
      }
    };
    
    // Setup track handler
    newPc.ontrack = (event) => {
      if (event.streams?.[0]) {
        setRemoteStream(event.streams[0]);
        configRef.current.onRemoteStream?.(event.streams[0]);
      }
    };
    
    // Note: ICE/connection state handlers are set by the caller if needed
    // (e.g., createRelayConnection sets them for mode detection)
    
    return newPc;
  }, []);

  // Lock mode permanently (called only by controller or when receiving from controller)
  const lockMode = useCallback((mode: ConnectionMode, details: ConnectionDetails) => {
    if (modeLockedRef.current) return;
    
    console.log('[WebRTC] LOCKING mode:', mode, 'role:', roleRef.current);
    modeLockedRef.current = true;
    setConnectionMode(mode);
    setConnectionDetails(details);
    
    // Clear fallback timer
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    
    // Only controller broadcasts mode
    if (roleRef.current === 'controller') {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'connection-mode', mode }));
        console.log('[WebRTC] Controller broadcasted mode:', mode);
      }
    }
  }, []);

  // Controller-only: detect mode from stats (single shot)
  const detectAndLockMode = useCallback(() => {
    if (roleRef.current !== 'controller' || modeLockedRef.current) return;
    
    const pc = pcRef.current;
    if (!pc || pc.connectionState === 'closed') return;
    
    pc.getStats().then(stats => {
      if (modeLockedRef.current) return;
      
      const statsArray = Array.from(stats.values());
      const candidatePairs = statsArray.filter((r: any) => r.type === 'candidate-pair');
      
      const selectedPair = candidatePairs.find((r: any) => r.selected === true) ||
                           candidatePairs.find((r: any) => r.state === 'succeeded' && r.nominated) ||
                           candidatePairs.find((r: any) => r.state === 'succeeded');
      
      if (!selectedPair) {
        console.log('[WebRTC] No selected pair yet, will detect on next event');
        return;
      }
      
      const localCandidate = statsArray.find((s: any) => s.id === selectedPair.localCandidateId);
      const remoteCandidate = statsArray.find((s: any) => s.id === selectedPair.remoteCandidateId);
      
      const isRelay = localCandidate?.candidateType === 'relay' || remoteCandidate?.candidateType === 'relay';
      const detectedMode: ConnectionMode = isRelay ? 'turn' : 'p2p';
      
      lockMode(detectedMode, {
        mode: detectedMode,
        remoteIP: remoteCandidate?.address,
        protocol: localCandidate?.protocol,
        turnServerIP: isRelay ? extractTurnServerHost(configRef.current.turnConfig?.urls || []) : undefined
      });
    }).catch(err => console.warn('[WebRTC] Stats error:', err));
  }, [lockMode]);

  // Controller-only: create relay-only connection for TURN fallback
  const createRelayConnection = useCallback(() => {
    if (roleRef.current !== 'controller' || modeLockedRef.current || fallbackTriggeredRef.current) return;
    
    fallbackTriggeredRef.current = true;
    const turnConfig = configRef.current.turnConfig;
    if (!turnConfig) {
      console.error('[WebRTC] No TURN config for fallback');
      return;
    }
    
    console.log('[WebRTC] Creating relay-only connection');
    setConnectionMode('reconnecting');
    
    // Notify follower to prepare for relay restart
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'relay-restart' }));
    }
    
    // Rebuild PC with relay-only policy
    const newPc = rebuildPeerConnection('relay');
    
    // Add ICE connection handlers for relay
    newPc.oniceconnectionstatechange = () => {
      console.log('[Relay] ICE:', newPc.iceConnectionState);
      if (newPc.iceConnectionState === 'connected' || newPc.iceConnectionState === 'completed') {
        lockMode('turn', { mode: 'turn', turnServerIP: extractTurnServerHost(turnConfig.urls) });
      }
    };
    
    // Create and send offer
    if (ws?.readyState === WebSocket.OPEN) {
      newPc.createOffer().then(offer => newPc.setLocalDescription(offer))
        .then(() => {
          ws.send(JSON.stringify({ type: 'offer', data: newPc.localDescription }));
          console.log('[Relay] Offer sent');
        }).catch(err => console.error('[Relay] Error:', err));
    }
  }, [lockMode, rebuildPeerConnection]);

  const sendMessage = useCallback((message: any) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'chat',
        data: { ...message, from: configRef.current.peerId, fromNickname: configRef.current.nickname },
      }));
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
          ws.send(JSON.stringify({ type: 'file-chunk', data: btoa(binary) }));
          
          chunksSent++;
          options?.onProgress?.(Math.round((chunksSent / totalChunks) * 100));
          await new Promise(r => setTimeout(r, 0));
        }
        
        ws.send(JSON.stringify({ type: 'file-eof', data: null }));
        resolve();
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }, []);

  const sendNCStatus = useCallback((enabled: boolean) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'nc-status', data: { enabled } }));
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
          wsRef.current?.send(JSON.stringify({ type: 'offer', data: offer }));
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

    // Reset all state for clean connection
    roleRef.current = null;
    modeLockedRef.current = false;
    fallbackTriggeredRef.current = false;
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
    dataChannel.onopen = () => console.log('[DataChannel] opened');

    // ICE candidate handling - use local array for outgoing, ref for incoming
    const pendingIceCandidates: RTCIceCandidate[] = [];
    pendingRemoteIceCandidatesRef.current = [];

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ice-candidate', data: event.candidate }));
        } else {
          pendingIceCandidates.push(event.candidate);
        }
      }
    };

    // Controller detects mode when connected
    pc.oniceconnectionstatechange = () => {
      console.log('[ICE]', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        if (roleRef.current === 'controller' && !modeLockedRef.current) {
          detectAndLockMode();
        }
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[Connection]', pc.connectionState);
      if (pc.connectionState === 'connected') {
        if (roleRef.current === 'controller' && !modeLockedRef.current) {
          detectAndLockMode();
        }
      } else if (pc.connectionState === 'failed') {
        // Only controller triggers fallback
        if (roleRef.current === 'controller' && !modeLockedRef.current && !fallbackTriggeredRef.current) {
          createRelayConnection();
        }
      }
    };

    pc.ontrack = (event) => {
      if (event.streams?.[0]) {
        setRemoteStream(event.streams[0]);
        configRef.current.onRemoteStream?.(event.streams[0]);
      }
    };

    ws.onopen = () => {
      console.log('[WS] Connected, joining room');
      ws.send(JSON.stringify({
        type: 'join',
        roomId: config.roomId,
        peerId: config.peerId,
        nickname: config.nickname,
      }));

      // Flush pending ICE candidates
      pendingIceCandidates.forEach(c => ws.send(JSON.stringify({ type: 'ice-candidate', data: c })));
      pendingIceCandidates.length = 0;
    };

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);

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
            configRef.current.onPeerConnected?.({ nickname: message.existingPeers[0]?.nickname });
            
            // Controller (first peer, room creator) waits for follower's offer
            // Follower (joiner) creates and sends offer
            if (roleRef.current === 'follower') {
              console.log('[Follower] Creating initial offer');
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              ws.send(JSON.stringify({ type: 'offer', data: offer }));
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
          setIsConnected(true);
          setConnectionState('connected');
          configRef.current.onPeerConnected?.({ nickname: message.nickname });
          
          // Controller starts fallback timer when peer joins
          if (roleRef.current === 'controller' && !modeLockedRef.current && !fallbackTriggeredRef.current) {
            console.log('[Controller] Starting 5s fallback timer');
            fallbackTimerRef.current = setTimeout(() => {
              fallbackTimerRef.current = null;
              if (!modeLockedRef.current && !fallbackTriggeredRef.current) {
                const state = pc.iceConnectionState;
                if (state !== 'connected' && state !== 'completed') {
                  console.log('[Controller] Fallback timer fired - triggering relay');
                  createRelayConnection();
                }
              }
            }, 5000);
          }
        } else if (message.type === 'offer') {
          console.log('[WebRTC] Received offer');
          await pc.setRemoteDescription(new RTCSessionDescription(message.data));
          
          // Flush buffered ICE candidates
          for (const c of pendingRemoteIceCandidatesRef.current) {
            await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
          }
          pendingRemoteIceCandidatesRef.current = [];
          
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          ws.send(JSON.stringify({ type: 'answer', data: answer }));
          console.log('[WebRTC] Answer sent');
        } else if (message.type === 'answer') {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(message.data));
            negotiatingRef.current = false;
            
            // Flush buffered ICE candidates
            for (const c of pendingRemoteIceCandidatesRef.current) {
              await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
            }
            pendingRemoteIceCandidatesRef.current = [];
            
            if (pendingStopRef.current) {
              pendingStopRef.current = false;
              setTimeout(() => stopVoiceChat(), 100);
            } else if (pendingNegotiationRef.current) {
              pendingNegotiationRef.current = false;
            }
          }
        } else if (message.type === 'ice-candidate') {
          if (message.data) {
            if (!pc.remoteDescription) {
              pendingRemoteIceCandidatesRef.current.push(message.data);
            } else {
              await pc.addIceCandidate(new RTCIceCandidate(message.data)).catch(() => {});
            }
          }
        } else if (message.type === 'relay-restart') {
          // Controller is restarting with relay - follower prepares for new offer
          console.log('[Follower] Relay restart from controller');
          if (roleRef.current === 'follower') {
            setConnectionMode('reconnecting');
            pendingRemoteIceCandidatesRef.current = [];
            // Rebuild PC to accept fresh offer from controller
            rebuildPeerConnection('all');
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
          console.log('[WebRTC] Peer left - hard reset');
          setIsConnected(false);
          setConnectionState('disconnected');
          setRemoteStream(null);
          setPeerNCEnabled(false);
          
          // Hard reset all mode and connection state
          modeLockedRef.current = false;
          fallbackTriggeredRef.current = false;
          pendingModeRef.current = null;
          setConnectionMode('pending');
          setConnectionDetails({ mode: 'pending' });
          
          // Clear fallback timer
          if (fallbackTimerRef.current) {
            clearTimeout(fallbackTimerRef.current);
            fallbackTimerRef.current = null;
          }
          
          // Use centralized rebuild helper
          rebuildPeerConnection('all');
          
          configRef.current.onRemoteStream?.(null);
          configRef.current.onPeerDisconnected?.();
        }
      } catch (error) {
        console.error('[WS] Message error:', error);
      }
    };

    ws.onclose = () => {
      console.log('[WS] Closed');
      setConnectionState('disconnected');
    };

    // Cleanup on unmount
    return () => {
      console.log('[WebRTC] Cleanup');
      
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
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
  }, [config.roomId, config.peerId, detectAndLockMode, createRelayConnection, lockMode, rebuildPeerConnection, stopVoiceChat]);

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
