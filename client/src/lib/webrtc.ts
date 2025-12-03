import { useEffect, useRef, useState, useCallback } from "react";

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
}

interface SendFileOptions {
  onProgress?: (progress: number) => void;
}

export type ConnectionMode = 'pending' | 'p2p' | 'turn' | 'reconnecting';

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
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  
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
  
  // P2P fallback state
  const fallbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasConnectedRef = useRef(false);
  const connectionModeRef = useRef<ConnectionMode>('pending');
  const detectedCandidateTypeRef = useRef<string | null>(null);
  
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

  const startVoiceChat = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      
      const pc = pcRef.current;
      
      if (pc) {
        stream.getTracks().forEach(track => {
          console.log('Adding audio track to peer connection');
          pc.addTrack(track, stream);
        });
        
        // Renegotiate with guard
        await performNegotiation();
      }

      return stream;
    } catch (error) {
      console.error('Error starting voice chat:', error);
      throw error;
    }
  }, [performNegotiation]);

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
      
      // Renegotiate with guard (only if connection is still open)
      if (pc && pc.signalingState !== 'closed') {
        performNegotiation();
      }
    }
  }, [performNegotiation]);

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

    // Reset connection mode tracking
    hasConnectedRef.current = false;
    connectionModeRef.current = 'pending';
    detectedCandidateTypeRef.current = null;
    setConnectionMode('pending');

    // Function to detect connection mode from ICE candidate type
    const detectConnectionMode = (candidateType: string) => {
      // host = direct P2P, srflx = P2P through NAT, relay = TURN
      if (candidateType === 'relay') {
        return 'turn';
      } else if (candidateType === 'host' || candidateType === 'srflx') {
        return 'p2p';
      }
      return 'pending';
    };

    let candidateCount = 0;
    pc.onicecandidate = (event) => {
      const currentWs = wsRef.current;
      if (event.candidate) {
        candidateCount++;
        console.log('ICE candidate:', event.candidate.type, event.candidate.protocol, event.candidate.address);
        
        // Track candidate types for mode detection
        if (event.candidate.type && !detectedCandidateTypeRef.current) {
          detectedCandidateTypeRef.current = event.candidate.type;
        }
        
        if (currentWs && currentWs.readyState === WebSocket.OPEN) {
          console.log('Sending ICE candidate to peer');
          currentWs.send(JSON.stringify({
            type: 'ice-candidate',
            data: event.candidate,
          }));
        } else {
          console.log('WebSocket not ready, queuing ICE candidate');
          pendingIceCandidates.push(event.candidate);
        }
      } else {
        console.log('ICE gathering complete, total candidates:', candidateCount);
        if (candidateCount === 0) {
          console.error('NO ICE candidates generated! TURN server may be unreachable or credentials invalid.');
        }
      }
    };

    // Function to detect connection mode from stats
    const detectModeFromStats = () => {
      const currentPc = pcRef.current;
      if (!currentPc || currentPc.connectionState === 'closed') return;
      
      currentPc.getStats().then(stats => {
        let selectedCandidateType: string | null = null;
        let remoteCandidateType: string | null = null;
        let localIP: string | undefined;
        let remoteIP: string | undefined;
        let localPort: number | undefined;
        let remotePort: number | undefined;
        let protocol: string | undefined;
        let relayServerIP: string | undefined;
        
        // Convert stats to array for easier processing
        const statsArray = Array.from(stats.values());
        
        // Find the ACTUALLY selected candidate pair
        // Priority: selected === true > (state === 'succeeded' && nominated) > state === 'succeeded'
        const candidatePairs = statsArray.filter((r: any) => r.type === 'candidate-pair');
        
        let selectedPair = candidatePairs.find((r: any) => r.selected === true);
        if (!selectedPair) {
          selectedPair = candidatePairs.find((r: any) => r.state === 'succeeded' && r.nominated === true);
        }
        if (!selectedPair) {
          selectedPair = candidatePairs.find((r: any) => r.state === 'succeeded');
        }
        
        // Now extract candidate info from the selected pair only
        if (selectedPair) {
          const localCandidate = statsArray.find((s: any) => s.id === selectedPair.localCandidateId && s.type === 'local-candidate');
          const remoteCandidate = statsArray.find((s: any) => s.id === selectedPair.remoteCandidateId && s.type === 'remote-candidate');
          
          if (localCandidate) {
            selectedCandidateType = localCandidate.candidateType;
            localIP = localCandidate.address || localCandidate.ip;
            localPort = localCandidate.port;
            protocol = localCandidate.protocol;
            if (localCandidate.candidateType === 'relay') {
              relayServerIP = localCandidate.relayAddress || localCandidate.address || localCandidate.ip;
            }
          }
          
          if (remoteCandidate) {
            remoteCandidateType = remoteCandidate.candidateType;
            remoteIP = remoteCandidate.address || remoteCandidate.ip;
            remotePort = remoteCandidate.port;
            if (remoteCandidate.candidateType === 'relay' && !relayServerIP) {
              relayServerIP = remoteCandidate.address || remoteCandidate.ip;
            }
          }
          
          console.log('Final selected pair - local:', selectedCandidateType, localIP, '| remote:', remoteCandidateType, remoteIP);
        }
        
        // Use local candidate type, fallback to remote, or check if either is relay
        const effectiveType = selectedCandidateType || remoteCandidateType;
        const isRelay = selectedCandidateType === 'relay' || remoteCandidateType === 'relay';
        
        if (effectiveType) {
          // If either side uses relay, it's TURN mode
          const mode = isRelay ? 'turn' : detectConnectionMode(effectiveType);
          if (connectionModeRef.current !== mode) {
            connectionModeRef.current = mode;
            setConnectionMode(mode);
            console.log('Connection mode detected:', mode, '(local:', selectedCandidateType, 'remote:', remoteCandidateType, ')');
          }
          
          // Update connection details - only show relevant IPs based on mode
          let details: ConnectionDetails;
          if (isRelay) {
            // TURN mode - get TURN server IP from stats or config URL
            let turnIP = relayServerIP || localIP;
            // Fallback to extracting from TURN config URL if not available from stats
            if (!turnIP && turnConfig?.urls) {
              turnIP = extractTurnServerHost(turnConfig.urls);
            }
            // Final fallback to remoteIP if nothing else worked
            if (!turnIP) {
              turnIP = remoteIP;
            }
            details = {
              mode,
              protocol,
              turnServerIP: turnIP,
            };
          } else {
            // P2P mode - show only remote peer's IP (not our local IP)
            details = {
              mode,
              remoteIP,
              remotePort,
              protocol,
            };
          }
          setConnectionDetails(details);
          console.log('Connection details:', details);
        } else if (connectionModeRef.current === 'pending') {
          // Retry after a short delay if we couldn't detect yet
          setTimeout(detectModeFromStats, 500);
        }
      }).catch(err => {
        console.warn('Could not get connection stats:', err);
      });
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
      
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        // Clear fallback timeout since we're connected
        if (fallbackTimeoutRef.current) {
          clearTimeout(fallbackTimeoutRef.current);
          fallbackTimeoutRef.current = null;
        }
        hasConnectedRef.current = true;
        
        // Detect connection mode using getStats
        detectModeFromStats();
      }
      
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        console.warn('ICE connection issue detected, may need to restart');
        // Only show "reconnecting" if we were previously connected
        if (hasConnectedRef.current && connectionModeRef.current !== 'pending') {
          connectionModeRef.current = 'reconnecting';
          setConnectionMode('reconnecting');
          // Reset connection details when reconnecting
          setConnectionDetails({ mode: 'reconnecting' });
        }
      }
    };

    pc.onicegatheringstatechange = () => {
      console.log('ICE gathering state:', pc.iceGatheringState);
    };

    pc.ontrack = (event) => {
      console.log('Received remote audio track, track kind:', event.track.kind);
      // Expose remote stream to UI for playback
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
        configRef.current.onRemoteStream?.(event.streams[0]);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('WebRTC connection state:', pc.connectionState);
      
      // Also detect mode when connection state changes to connected
      if (pc.connectionState === 'connected') {
        hasConnectedRef.current = true;
        // Clear fallback timeout
        if (fallbackTimeoutRef.current) {
          clearTimeout(fallbackTimeoutRef.current);
          fallbackTimeoutRef.current = null;
        }
        // Detect connection mode
        detectModeFromStats();
      }
      
      // Handle connection failures by triggering ICE restart
      if (pc.connectionState === 'failed') {
        console.log('WebRTC connection failed, attempting ICE restart');
        // Only restart if in stable signaling state to avoid "Called in wrong state" error
        if (pc.signalingState === 'stable' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          pc.createOffer({ iceRestart: true }).then(offer => {
            return pc.setLocalDescription(offer);
          }).then(() => {
            wsRef.current!.send(JSON.stringify({
              type: 'offer',
              data: pc.localDescription,
            }));
          }).catch(err => {
            console.error('Error restarting ICE:', err);
          });
        } else {
          console.log('ICE restart deferred: signaling state is', pc.signalingState);
        }
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
          console.log(`[${isJoiner ? 'JOINER' : 'CREATOR'}] Joined room, existing peers:`, message.existingPeers);
          console.log(`[${isJoiner ? 'JOINER' : 'CREATOR'}] ICE servers count:`, currentPc?.getConfiguration().iceServers?.length || 0);
          setIsConnected(true);
          setConnectionState('connected');
          
          if (isJoiner) {
            configRef.current.onPeerConnected?.({ nickname: message.existingPeers[0]?.nickname });
            
            // Create WebRTC offer for voice (joiner initiates)
            if (currentPc && currentWs && currentWs.readyState === WebSocket.OPEN) {
              console.log('[JOINER] Creating initial offer...');
              console.log('[JOINER] PC ICE gathering state before offer:', currentPc.iceGatheringState);
              const offer = await currentPc.createOffer();
              await currentPc.setLocalDescription(offer);
              console.log('[JOINER] Local description set, ICE gathering state:', currentPc.iceGatheringState);
              currentWs.send(JSON.stringify({
                type: 'offer',
                data: offer,
              }));
              console.log('[JOINER] Offer sent, waiting for ICE candidates...');
              
              // Start TURN fallback timer (5 seconds)
              if (fallbackTimeoutRef.current) {
                clearTimeout(fallbackTimeoutRef.current);
              }
              fallbackTimeoutRef.current = setTimeout(() => {
                // Check if we're still not connected
                if (!hasConnectedRef.current && currentPc.iceConnectionState !== 'connected' && currentPc.iceConnectionState !== 'completed') {
                  console.log('[FALLBACK] P2P connection timeout, falling back to TURN-only mode');
                  
                  // Close current connection and create a new one with relay-only policy
                  // This will force the connection through TURN
                  if (currentPc.signalingState !== 'closed') {
                    currentPc.restartIce();
                    
                    // Create a new offer with iceRestart to force re-negotiation
                    currentPc.createOffer({ iceRestart: true }).then(newOffer => {
                      return currentPc.setLocalDescription(newOffer);
                    }).then(() => {
                      if (currentWs && currentWs.readyState === WebSocket.OPEN) {
                        currentWs.send(JSON.stringify({
                          type: 'offer',
                          data: currentPc.localDescription,
                        }));
                        console.log('[FALLBACK] ICE restart offer sent');
                        
                        // Set mode to TURN since we're forcing relay
                        connectionModeRef.current = 'turn';
                        setConnectionMode('turn');
                      }
                    }).catch(err => {
                      console.error('[FALLBACK] Error during ICE restart:', err);
                    });
                  }
                }
              }, 5000);
            }
          }
        } else if (message.type === 'peer-joined') {
          console.log('Peer joined:', message.peerId, message.nickname);
          setIsConnected(true);
          setConnectionState('connected');
          configRef.current.onPeerConnected?.({ nickname: message.nickname });
        } else if (message.type === 'offer') {
          if (currentPc && currentWs && currentWs.readyState === WebSocket.OPEN) {
            console.log('Received offer, setting remote description');
            console.log('Current signaling state before offer:', currentPc.signalingState);
            
            try {
              await currentPc.setRemoteDescription(new RTCSessionDescription(message.data));
            } catch (sdpError: any) {
              // If SDP error (e.g., m-line order mismatch), we need to recreate the peer connection
              if (sdpError.message?.includes('m-lines') || sdpError.message?.includes('Failed to set remote')) {
                console.log('[RECONNECT] SDP incompatible, recreating peer connection...');
                
                // Close old peer connection
                currentPc.close();
                
                // Recreate peer connection with same config
                const newPc = new RTCPeerConnection(currentPc.getConfiguration());
                pcRef.current = newPc;
                
                // Create data channel for ICE gathering
                const dataChannel = newPc.createDataChannel('connection-init', { negotiated: true, id: 0 });
                dataChannel.onopen = () => console.log('[DataChannel] Connection channel opened');
                dataChannel.onclose = () => console.log('[DataChannel] Connection channel closed');
                
                // Re-add local stream if exists
                if (localStreamRef.current) {
                  localStreamRef.current.getTracks().forEach(track => {
                    newPc.addTrack(track, localStreamRef.current!);
                  });
                }
                
                // Setup event handlers on new PC
                newPc.onicecandidate = (event) => {
                  if (event.candidate && currentWs.readyState === WebSocket.OPEN) {
                    console.log('ICE candidate:', event.candidate.type, event.candidate.protocol, event.candidate.address);
                    currentWs.send(JSON.stringify({ type: 'ice-candidate', data: event.candidate }));
                  }
                };
                
                newPc.oniceconnectionstatechange = () => {
                  console.log('ICE connection state:', newPc.iceConnectionState);
                  if (newPc.iceConnectionState === 'connected' || newPc.iceConnectionState === 'completed') {
                    hasConnectedRef.current = true;
                    connectionModeRef.current = 'pending';
                    detectModeFromStats();
                  }
                };
                
                newPc.onconnectionstatechange = () => {
                  console.log('WebRTC connection state:', newPc.connectionState);
                  if (newPc.connectionState === 'connected') {
                    hasConnectedRef.current = true;
                    detectModeFromStats();
                  }
                };
                
                newPc.ontrack = (event) => {
                  console.log('Received remote audio track');
                  if (event.streams && event.streams[0]) {
                    setRemoteStream(event.streams[0]);
                    configRef.current.onRemoteStream?.(event.streams[0]);
                  }
                };
                
                // Now set the remote description on the new PC
                await newPc.setRemoteDescription(new RTCSessionDescription(message.data));
                console.log('[RECONNECT] Remote description set on new peer connection');
                
                // Create and send answer
                const answer = await newPc.createAnswer();
                await newPc.setLocalDescription(answer);
                currentWs.send(JSON.stringify({ type: 'answer', data: answer }));
                console.log('[RECONNECT] Answer sent');
                
                // Reset connection mode
                connectionModeRef.current = 'pending';
                setConnectionMode('pending');
                return;
              }
              throw sdpError;
            }
            
            console.log('Remote description set from offer, new signaling state:', currentPc.signalingState);
            
            // If we have a local stream, add our tracks before creating the answer
            if (localStreamRef.current) {
              const existingTracks = currentPc.getSenders().map(s => s.track);
              localStreamRef.current.getTracks().forEach(track => {
                // Only add track if it's not already added
                if (!existingTracks.includes(track)) {
                  console.log('Adding local audio track when answering offer');
                  currentPc.addTrack(track, localStreamRef.current!);
                }
              });
            }
            
            console.log('Creating answer');
            const answer = await currentPc.createAnswer();
            await currentPc.setLocalDescription(answer);
            console.log('Sending answer, signaling state:', currentPc.signalingState);
            currentWs.send(JSON.stringify({
              type: 'answer',
              data: answer,
            }));
            console.log('Answer sent');
            
            // Flush any buffered remote ICE candidates now that remote description is set
            if (pendingRemoteIceCandidates.length > 0) {
              console.log('[CREATOR] Flushing', pendingRemoteIceCandidates.length, 'buffered remote ICE candidates');
              for (const candidate of pendingRemoteIceCandidates) {
                try {
                  await currentPc.addIceCandidate(new RTCIceCandidate(candidate));
                  console.log('[CREATOR] Added buffered ICE candidate successfully');
                } catch (err) {
                  console.error('[CREATOR] Failed to add buffered ICE candidate:', err);
                }
              }
              pendingRemoteIceCandidates.length = 0;
            }
            
            // Trigger continuous mode detection after answer is sent (for creator/hoster)
            // Keep polling until connection is established
            let creatorPollCount = 0;
            const creatorPollInterval = setInterval(() => {
              creatorPollCount++;
              console.log('[CREATOR] Polling for connection mode, attempt:', creatorPollCount, 'pc state:', currentPc?.iceConnectionState);
              
              if (connectionModeRef.current !== 'pending' || creatorPollCount >= 30) {
                console.log('[CREATOR] Stopping poll - mode:', connectionModeRef.current, 'attempts:', creatorPollCount);
                clearInterval(creatorPollInterval);
                return;
              }
              
              if (currentPc && (currentPc.iceConnectionState === 'connected' || currentPc.iceConnectionState === 'completed')) {
                console.log('[CREATOR] ICE connected, detecting mode');
                detectModeFromStats();
              }
            }, 500);
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
              
              // Flush any buffered remote ICE candidates now that remote description is set
              if (pendingRemoteIceCandidates.length > 0) {
                console.log('[JOINER] Flushing', pendingRemoteIceCandidates.length, 'buffered remote ICE candidates');
                for (const candidate of pendingRemoteIceCandidates) {
                  try {
                    await currentPc.addIceCandidate(new RTCIceCandidate(candidate));
                    console.log('[JOINER] Added buffered ICE candidate successfully');
                  } catch (err) {
                    console.error('[JOINER] Failed to add buffered ICE candidate:', err);
                  }
                }
                pendingRemoteIceCandidates.length = 0;
              }
              
              // Trigger mode detection after answer is received (for joiner)
              setTimeout(() => {
                if (connectionModeRef.current === 'pending') {
                  console.log('[JOINER] Triggering delayed mode detection after receiving answer');
                  detectModeFromStats();
                }
              }, 1000);
              
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
            console.log('Received ICE candidate from peer:', message.data.type, message.data.protocol, message.data.address);
            
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
          configRef.current.onRemoteStream?.(null);
          configRef.current.onPeerDisconnected?.();
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
      
      // Clear TURN fallback timeout
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
        fallbackTimeoutRef.current = null;
      }
      
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
  };
}
