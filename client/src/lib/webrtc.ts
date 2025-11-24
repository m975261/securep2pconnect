import { useEffect, useRef, useState, useCallback } from "react";

interface WebRTCConfig {
  roomId: string;
  peerId: string;
  nickname?: string;
  onMessage?: (message: any) => void;
  onFileReceive?: (file: { name: string; data: ArrayBuffer }) => void;
  onPeerConnected?: (peerInfo?: { nickname?: string }) => void;
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
        {
          urls: [
            'turn:openrelay.metered.ca:80',
            'turn:openrelay.metered.ca:443',
            'turn:openrelay.metered.ca:443?transport=tcp',
            'turns:openrelay.metered.ca:443?transport=tcp'
          ],
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
      ],
      iceTransportPolicy: 'all',
      iceCandidatePoolSize: 10,
    });
    pcRef.current = pc;

    const setupDataChannels = () => {
      const chatChannel = pc.createDataChannel('chat');
      chatChannelRef.current = chatChannel;

      chatChannel.onopen = () => {
        console.log('Chat channel opened');
      };

      chatChannel.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('Received chat message:', message);
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
            if (!fileMetadata) {
              console.error('Received EOF without file metadata');
              return;
            }
            const blob = new Blob(fileChunks);
            const capturedMetadata = fileMetadata;
            const reader = new FileReader();
            reader.onload = () => {
              config.onFileReceive?.({
                name: capturedMetadata.name,
                data: reader.result as ArrayBuffer,
              });
            };
            reader.readAsArrayBuffer(blob);
            fileChunks = [];
            fileMetadata = null;
          } else {
            try {
              fileMetadata = JSON.parse(event.data);
            } catch (error) {
              console.error('Error parsing file metadata:', error);
            }
          }
        } else {
          fileChunks.push(event.data);
        }
      };
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('ICE candidate:', event.candidate.type, event.candidate.protocol, event.candidate.address);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'ice-candidate',
            data: event.candidate,
          }));
        }
      } else {
        console.log('ICE gathering complete');
      }
    };

    pc.onicegatheringstatechange = () => {
      console.log('ICE gathering state:', pc.iceGatheringState);
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
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

    pc.ondatachannel = (event) => {
      console.log('Received data channel:', event.channel.label);
      
      if (event.channel.label === 'chat') {
        chatChannelRef.current = event.channel;
        
        event.channel.onopen = () => {
          console.log('Remote chat channel opened');
        };
        
        event.channel.onmessage = (msgEvent) => {
          try {
            const message = JSON.parse(msgEvent.data);
            console.log('Received chat message:', message);
            config.onMessage?.(message);
          } catch (error) {
            console.error('Error parsing chat message:', error);
          }
        };
      } else if (event.channel.label === 'files') {
        fileChannelRef.current = event.channel;
        
        let fileMetadata: any = null;
        let fileChunks: ArrayBuffer[] = [];
        
        event.channel.onmessage = (msgEvent) => {
          if (typeof msgEvent.data === 'string') {
            if (msgEvent.data === 'EOF') {
              if (!fileMetadata) {
                console.error('Received EOF without file metadata');
                return;
              }
              const blob = new Blob(fileChunks);
              const capturedMetadata = fileMetadata;
              const reader = new FileReader();
              reader.onload = () => {
                config.onFileReceive?.({
                  name: capturedMetadata.name,
                  data: reader.result as ArrayBuffer,
                });
              };
              reader.readAsArrayBuffer(blob);
              fileChunks = [];
              fileMetadata = null;
            } else {
              try {
                fileMetadata = JSON.parse(msgEvent.data);
              } catch (error) {
                console.error('Error parsing file metadata:', error);
              }
            }
          } else {
            fileChunks.push(msgEvent.data);
          }
        };
      }
    };

    setupDataChannels();

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'join',
        roomId: config.roomId,
        peerId: config.peerId,
        nickname: config.nickname,
      }));
    };

    ws.onmessage = async (event) => {
      const message = JSON.parse(event.data);

      if (message.type === 'joined') {
        console.log('Joined room, existing peers:', message.existingPeers);
        if (message.existingPeers.length > 0) {
          config.onPeerConnected?.({ nickname: message.existingPeers[0]?.nickname });
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          ws.send(JSON.stringify({
            type: 'offer',
            data: offer,
          }));
        }
      } else if (message.type === 'peer-joined') {
        console.log('Peer joined:', message.peerId, message.nickname);
        config.onPeerConnected?.({ nickname: message.nickname });
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
      if (chatChannelRef.current) {
        chatChannelRef.current.close();
      }
      if (fileChannelRef.current) {
        fileChannelRef.current.close();
      }
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
