import { useEffect, useRef, useState, useCallback } from "react";

interface WebRTCP2PConfig {
  onMessage?: (message: any) => void;
  onFileReceive?: (file: { name: string; type: string; size: number; data: ArrayBuffer; from?: string; fromNickname?: string }) => void;
  onPeerConnected?: (peerInfo?: { peerId?: string }) => void;
  onPeerDisconnected?: () => void;
  onRemoteStream?: (stream: MediaStream | null) => void;
  onHelperConnected?: (localPeerId: string) => void;
}

interface SendFileOptions {
  onProgress?: (progress: number) => void;
}

/**
 * WebRTC hook with P2P helper architecture
 * Connects to local helper (ws://127.0.0.1:52100) instead of central signaling server
 */
export function useWebRTCP2P(config: WebRTCP2PConfig) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localPeerId, setLocalPeerId] = useState<string>("");
  const [remotePeerId, setRemotePeerId] = useState<string>("");
  const [helperConnected, setHelperConnected] = useState(false);
  
  const helperWsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  
  // File transfer state
  const fileMetadataRef = useRef<any>(null);
  const fileChunksRef = useRef<ArrayBuffer[]>([]);
  
  // Negotiation state
  const negotiatingRef = useRef(false);
  const pendingNegotiationRef = useRef(false);
  const pendingStopRef = useRef(false);
  
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  });

  const sendMessage = useCallback((message: any) => {
    const ws = helperWsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && remotePeerId) {
      ws.send(JSON.stringify({
        type: 'chat',
        to: remotePeerId,
        data: {
          ...message,
          from: localPeerId,
        },
      }));
    }
  }, [localPeerId, remotePeerId]);

  const sendFile = useCallback((file: File, options?: SendFileOptions) => {
    return new Promise<void>((resolve, reject) => {
      const ws = helperWsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !remotePeerId) {
        reject(new Error('Not connected to helper or peer'));
        return;
      }

      console.log('Starting file transfer:', file.name);
      const reader = new FileReader();
      reader.onload = () => {
        const arrayBuffer = reader.result as ArrayBuffer;
        
        // Send metadata
        const metadata = {
          name: file.name,
          size: file.size,
          type: file.type,
          from: localPeerId,
        };
        
        ws.send(JSON.stringify({
          type: 'file-metadata',
          to: remotePeerId,
          data: metadata,
        }));
        
        // Send file in chunks
        const chunkSize = 16384;
        const totalChunks = Math.ceil(arrayBuffer.byteLength / chunkSize);
        let chunksSent = 0;
        
        const sendChunks = async () => {
          for (let offset = 0; offset < arrayBuffer.byteLength; offset += chunkSize) {
            if (!ws || ws.readyState !== WebSocket.OPEN) {
              reject(new Error('Connection lost'));
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
              to: remotePeerId,
              data: base64Chunk,
            }));
            
            chunksSent++;
            const progress = Math.round((chunksSent / totalChunks) * 100);
            options?.onProgress?.(progress);
            
            await new Promise(resolve => setTimeout(resolve, 0));
          }
          
          ws.send(JSON.stringify({
            type: 'file-eof',
            to: remotePeerId,
          }));
          
          resolve();
        };
        
        sendChunks();
      };
      reader.readAsArrayBuffer(file);
    });
  }, [localPeerId, remotePeerId]);

  const performNegotiation = useCallback(async () => {
    const pc = pcRef.current;
    const ws = helperWsRef.current;

    if (negotiatingRef.current) {
      console.log('Negotiation blocked: already negotiating, marking pending');
      pendingNegotiationRef.current = true;
      return;
    }

    if (!pc || !ws || ws.readyState !== WebSocket.OPEN || !remotePeerId) {
      console.log('Cannot negotiate: not ready');
      return;
    }

    try {
      negotiatingRef.current = true;
      console.log('Creating offer for negotiation');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      ws.send(JSON.stringify({
        type: 'offer',
        to: remotePeerId,
        data: offer,
      }));
      
      console.log('Offer sent to helper');
    } catch (error) {
      console.error('Error during negotiation:', error);
      negotiatingRef.current = false;
      
      if (pendingNegotiationRef.current) {
        pendingNegotiationRef.current = false;
        setTimeout(() => performNegotiation(), 100);
      }
    }
  }, [remotePeerId]);

  const startVoiceChat = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      
      const pc = pcRef.current;
      if (pc) {
        stream.getTracks().forEach(track => {
          console.log('Adding audio track');
          pc.addTrack(track, stream);
        });
        
        await performNegotiation();
      }

      return stream;
    } catch (error) {
      console.error('Error starting voice:', error);
      throw error;
    }
  }, [performNegotiation]);

  const startVideoChat = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStreamRef.current = stream;
      
      const pc = pcRef.current;
      if (pc) {
        stream.getTracks().forEach(track => {
          console.log('Adding track:', track.kind);
          pc.addTrack(track, stream);
        });
        
        await performNegotiation();
      }

      return stream;
    } catch (error) {
      console.error('Error starting video:', error);
      throw error;
    }
  }, [performNegotiation]);

  const stopVoiceChat = useCallback(() => {
    if (negotiatingRef.current) {
      console.log('Deferring stopVoiceChat');
      pendingStopRef.current = true;
      return;
    }
    
    if (localStreamRef.current) {
      const pc = pcRef.current;
      
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
        if (pc) {
          const sender = pc.getSenders().find(s => s.track === track);
          if (sender) {
            pc.removeTrack(sender);
          }
        }
      });
      
      localStreamRef.current = null;
      performNegotiation();
    }
  }, [performNegotiation]);

  const connectToPeer = useCallback((peerIdToConnect: string) => {
    const ws = helperWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('Helper not connected');
      return;
    }

    console.log('Requesting connection to peer:', peerIdToConnect);
    
    // Update ref immediately to avoid stale closure in performNegotiation
    remotePeerIdRef.current = peerIdToConnect;
    setRemotePeerId(peerIdToConnect);
    
    ws.send(JSON.stringify({
      type: 'connect-peer',
      data: JSON.stringify(peerIdToConnect),
    }));
  }, []);

  useEffect(() => {
    // Connect to local P2P helper
    const helperUrl = 'ws://127.0.0.1:52100';
    console.log('Connecting to P2P helper at', helperUrl);
    
    const ws = new WebSocket(helperUrl);
    helperWsRef.current = ws;

    // Create peer connection
    const pc = new RTCPeerConnection({
      iceServers: [], // No STUN/TURN needed - helper provides relay via libp2p
    });
    pcRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate && ws.readyState === WebSocket.OPEN && remotePeerId) {
        console.log('ICE candidate:', event.candidate.type);
        ws.send(JSON.stringify({
          type: 'ice-candidate',
          to: remotePeerId,
          data: event.candidate,
        }));
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
    };

    pc.ontrack = (event) => {
      console.log('Received remote audio track');
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
        configRef.current.onRemoteStream?.(event.streams[0]);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('WebRTC connection state:', pc.connectionState);
      
      if (pc.connectionState === 'connected') {
        setIsConnected(true);
        setConnectionState('connected');
        configRef.current.onPeerConnected?.({ peerId: remotePeerId });
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setIsConnected(false);
        setConnectionState('disconnected');
        configRef.current.onPeerDisconnected?.();
      }
    };

    ws.onopen = () => {
      console.log('✓ Connected to P2P helper');
      setHelperConnected(true);
      setConnectionState('connecting');
    };

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('← From helper:', message.type);

        switch (message.type) {
          case 'peer-id':
            // Helper sent us our local PeerID
            setLocalPeerId(message.peerId);
            configRef.current.onHelperConnected?.(message.peerId);
            console.log('🆔 Local PeerID:', message.peerId);
            break;

          case 'peer-connected':
            console.log('✓ Connected to peer:', message.peerId);
            setRemotePeerId(message.peerId);
            break;

          case 'offer':
            if (pc && message.data) {
              console.log('Received offer via helper');
              await pc.setRemoteDescription(new RTCSessionDescription(message.data));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              
              ws.send(JSON.stringify({
                type: 'answer',
                to: message.from || remotePeerId,
                data: answer,
              }));
              
              console.log('Answer sent via helper');
            }
            break;

          case 'answer':
            if (pc && pc.signalingState === 'have-local-offer' && message.data) {
              console.log('Received answer via helper');
              await pc.setRemoteDescription(new RTCSessionDescription(message.data));
              negotiatingRef.current = false;
              
              if (pendingStopRef.current) {
                pendingStopRef.current = false;
                setTimeout(() => stopVoiceChat(), 100);
              } else if (pendingNegotiationRef.current) {
                pendingNegotiationRef.current = false;
                setTimeout(() => performNegotiation(), 100);
              }
            }
            break;

          case 'ice-candidate':
            if (pc && message.data) {
              await pc.addIceCandidate(new RTCIceCandidate(message.data));
            }
            break;

          case 'chat':
            configRef.current.onMessage?.(message.data);
            break;

          case 'file-metadata':
            fileMetadataRef.current = message.data;
            fileChunksRef.current = [];
            break;

          case 'file-chunk':
            const binaryString = atob(message.data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            fileChunksRef.current.push(bytes.buffer);
            break;

          case 'file-eof':
            if (fileMetadataRef.current) {
              const blob = new Blob(fileChunksRef.current, { type: fileMetadataRef.current.type });
              const reader = new FileReader();
              reader.onload = () => {
                configRef.current.onFileReceive?.({
                  name: fileMetadataRef.current.name,
                  type: fileMetadataRef.current.type,
                  size: fileMetadataRef.current.size,
                  data: reader.result as ArrayBuffer,
                  from: fileMetadataRef.current.from,
                });
              };
              reader.readAsArrayBuffer(blob);
              
              fileChunksRef.current = [];
              fileMetadataRef.current = null;
            }
            break;
        }
      } catch (error) {
        console.error('Helper message error:', error);
      }
    };

    ws.onclose = () => {
      console.log('✗ Disconnected from P2P helper');
      setHelperConnected(false);
      setConnectionState('disconnected');
    };

    ws.onerror = (error) => {
      console.error('Helper WebSocket error:', error);
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      if (pc.connectionState !== 'closed') {
        pc.close();
      }
      if (localStreamRef.current) {
        stopVoiceChat();
      }
    };
  }, [performNegotiation, stopVoiceChat, remotePeerId]);

  return {
    isConnected,
    connectionState,
    remoteStream,
    sendMessage,
    sendFile,
    startVoiceChat,
    startVideoChat,
    stopVoiceChat,
    connectToPeer,
    localPeerId,
    remotePeerId,
    helperConnected,
  };
}
