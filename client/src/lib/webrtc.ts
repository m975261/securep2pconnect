import { useEffect, useRef, useState, useCallback } from "react";

interface WebRTCConfig {
  roomId: string;
  peerId: string;
  onMessage?: (message: any) => void;
  onFileReceive?: (file: { name: string; data: ArrayBuffer }) => void;
  onPeerConnected?: () => void;
  onPeerDisconnected?: () => void;
}

export function useWebRTC(config: WebRTCConfig) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const chatChannelRef = useRef<RTCDataChannel | null>(null);
  const fileChannelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const sendMessage = useCallback((message: any) => {
    if (chatChannelRef.current?.readyState === 'open') {
      chatChannelRef.current.send(JSON.stringify(message));
    }
  }, []);

  const sendFile = useCallback((file: File) => {
    return new Promise<void>((resolve, reject) => {
      if (fileChannelRef.current?.readyState !== 'open') {
        reject(new Error('File channel not open'));
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const arrayBuffer = reader.result as ArrayBuffer;
        const metadata = JSON.stringify({
          name: file.name,
          size: file.size,
          type: file.type,
        });
        
        fileChannelRef.current!.send(metadata);
        
        const chunkSize = 16384;
        for (let offset = 0; offset < arrayBuffer.byteLength; offset += chunkSize) {
          const chunk = arrayBuffer.slice(offset, offset + chunkSize);
          fileChannelRef.current!.send(chunk);
        }
        
        fileChannelRef.current!.send('EOF');
        resolve();
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }, []);

  const startVoiceChat = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      
      stream.getTracks().forEach(track => {
        pcRef.current?.addTrack(track, stream);
      });

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

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
    pcRef.current = pc;

    const chatChannel = pc.createDataChannel('chat');
    chatChannelRef.current = chatChannel;

    chatChannel.onopen = () => {
      console.log('Chat channel opened');
    };

    chatChannel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        config.onMessage?.(message);
      } catch (error) {
        console.error('Error parsing chat message:', error);
      }
    };

    const fileChannel = pc.createDataChannel('files');
    fileChannelRef.current = fileChannel;

    let fileMetadata: any = null;
    let fileChunks: ArrayBuffer[] = [];

    fileChannel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        if (event.data === 'EOF') {
          const blob = new Blob(fileChunks);
          const reader = new FileReader();
          reader.onload = () => {
            config.onFileReceive?.({
              name: fileMetadata.name,
              data: reader.result as ArrayBuffer,
            });
          };
          reader.readAsArrayBuffer(blob);
          fileChunks = [];
          fileMetadata = null;
        } else {
          fileMetadata = JSON.parse(event.data);
        }
      } else {
        fileChunks.push(event.data);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'ice-candidate',
          data: event.candidate,
        }));
      }
    };

    pc.ontrack = (event) => {
      console.log('Received remote track:', event.track.kind);
    };

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        setIsConnected(true);
        setConnectionState('connected');
        config.onPeerConnected?.();
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setIsConnected(false);
        setConnectionState('disconnected');
        config.onPeerDisconnected?.();
      }
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'join',
        roomId: config.roomId,
        peerId: config.peerId,
      }));
    };

    ws.onmessage = async (event) => {
      const message = JSON.parse(event.data);

      if (message.type === 'joined') {
        console.log('Joined room, existing peers:', message.existingPeers);
        if (message.existingPeers.length > 0) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          ws.send(JSON.stringify({
            type: 'offer',
            data: offer,
          }));
        }
      } else if (message.type === 'peer-joined') {
        console.log('Peer joined:', message.peerId);
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
      } else if (message.type === 'peer-left') {
        console.log('Peer left:', message.peerId);
        setIsConnected(false);
        setConnectionState('disconnected');
        config.onPeerDisconnected?.();
      }
    };

    return () => {
      chatChannel.close();
      fileChannel.close();
      pc.close();
      ws.close();
      stopVoiceChat();
    };
  }, [config.roomId, config.peerId]);

  return {
    isConnected,
    connectionState,
    sendMessage,
    sendFile,
    startVoiceChat,
    stopVoiceChat,
  };
}
