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

export function useWebRTC(config: WebRTCConfig) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
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
    
    // Queue for ICE candidates that arrive before WebSocket is ready
    const pendingIceCandidates: RTCIceCandidate[] = [];

    const pc = new RTCPeerConnection({
      iceServers,
      // Force relay-only mode to prevent IP leakage
      iceTransportPolicy: 'relay',
      iceCandidatePoolSize: 10,
    });
    pcRef.current = pc;

    let candidateCount = 0;
    pc.onicecandidate = (event) => {
      const currentWs = wsRef.current;
      if (event.candidate) {
        candidateCount++;
        console.log('ICE candidate:', event.candidate.type, event.candidate.protocol, event.candidate.address);
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

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        console.warn('ICE connection issue detected, may need to restart');
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
          console.log('Joined room, existing peers:', message.existingPeers);
          setIsConnected(true);
          setConnectionState('connected');
          
          if (message.existingPeers.length > 0) {
            configRef.current.onPeerConnected?.({ nickname: message.existingPeers[0]?.nickname });
            
            // Create WebRTC offer for voice
            if (currentPc && currentWs && currentWs.readyState === WebSocket.OPEN) {
              const offer = await currentPc.createOffer();
              await currentPc.setLocalDescription(offer);
              currentWs.send(JSON.stringify({
                type: 'offer',
                data: offer,
              }));
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
            await currentPc.setRemoteDescription(new RTCSessionDescription(message.data));
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
            try {
              await currentPc.addIceCandidate(new RTCIceCandidate(message.data));
              console.log('Added ICE candidate successfully');
            } catch (err) {
              console.error('Failed to add ICE candidate:', err);
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
    remoteStream,
    sendMessage,
    sendFile,
    startVoiceChat,
    stopVoiceChat,
  };
}
