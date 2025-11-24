import { useEffect, useRef, useState, useCallback } from "react";

interface WebRTCConfig {
  roomId: string;
  peerId: string;
  nickname?: string;
  onMessage?: (message: any) => void;
  onFileReceive?: (file: { name: string; type: string; size: number; data: ArrayBuffer; from?: string; fromNickname?: string }) => void;
  onPeerConnected?: (peerInfo?: { nickname?: string }) => void;
  onPeerDisconnected?: () => void;
}

interface SendFileOptions {
  onProgress?: (progress: number) => void;
}

export function useWebRTC(config: WebRTCConfig) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  
  // File transfer state
  const fileMetadataRef = useRef<any>(null);
  const fileChunksRef = useRef<ArrayBuffer[]>([]);
  
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
        
        for (let offset = 0; offset < arrayBuffer.byteLength; offset += chunkSize) {
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
      reader.onerror = (error) => {
        console.error('FileReader error:', error);
        reject(error);
      };
      reader.readAsArrayBuffer(file);
    });
  }, []);

  const startVoiceChat = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      
      const pc = pcRef.current;
      const ws = wsRef.current;
      
      if (pc && ws && ws.readyState === WebSocket.OPEN) {
        stream.getTracks().forEach(track => {
          pc.addTrack(track, stream);
        });
        
        // Always renegotiate when adding tracks
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({
          type: 'offer',
          data: offer,
        }));
      }

      return stream;
    } catch (error) {
      console.error('Error starting voice chat:', error);
      throw error;
    }
  }, []);

  const stopVoiceChat = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
  }, []);

  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // Simple WebRTC peer connection for voice only
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        {
          urls: 'turn:numb.viagenie.ca',
          username: 'webrtc@live.com',
          credential: 'muazkh',
        },
      ],
    });
    pcRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'ice-candidate',
          data: event.candidate,
        }));
      }
    };

    pc.ontrack = (event) => {
      console.log('Received remote audio track');
      // The remote stream will be available in event.streams[0]
      // UI components can access this via refs if needed
    };

    pc.onconnectionstatechange = () => {
      console.log('WebRTC connection state:', pc.connectionState);
    };

    ws.onopen = () => {
      console.log('WebSocket connected');
      ws.send(JSON.stringify({
        type: 'join',
        roomId: configRef.current.roomId,
        peerId: configRef.current.peerId,
        nickname: configRef.current.nickname,
      }));
    };

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === 'joined') {
          console.log('Joined room, existing peers:', message.existingPeers);
          setIsConnected(true);
          setConnectionState('connected');
          
          if (message.existingPeers.length > 0) {
            configRef.current.onPeerConnected?.({ nickname: message.existingPeers[0]?.nickname });
            
            // Create WebRTC offer for voice
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            ws.send(JSON.stringify({
              type: 'offer',
              data: offer,
            }));
          }
        } else if (message.type === 'peer-joined') {
          console.log('Peer joined:', message.peerId, message.nickname);
          setIsConnected(true);
          setConnectionState('connected');
          configRef.current.onPeerConnected?.({ nickname: message.nickname });
        } else if (message.type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(message.data));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          ws.send(JSON.stringify({
            type: 'answer',
            data: answer,
          }));
        } else if (message.type === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(message.data));
        } else if (message.type === 'ice-candidate') {
          await pc.addIceCandidate(new RTCIceCandidate(message.data));
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
          configRef.current.onPeerDisconnected?.();
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket closed');
      setIsConnected(false);
      setConnectionState('disconnected');
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    return () => {
      pc.close();
      ws.close();
      stopVoiceChat();
    };
  }, [config.roomId, config.peerId, config.nickname]);

  return {
    isConnected,
    connectionState,
    sendMessage,
    sendFile,
    startVoiceChat,
    stopVoiceChat,
  };
}
