import { motion } from "framer-motion";
import { 
  Mic, MicOff, Share2, MessageSquare, FileText, Copy, Check, Volume2, VolumeX, Download, Wifi, WifiOff
} from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChatInterface } from "@/components/chat-interface";
import { FileTransfer } from "@/components/file-transfer";
import { DebugPanel } from "@/components/debug-panel";
import { useWebRTCP2P } from "@/lib/webrtc-p2p";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";

export default function P2PRoom() {
  const [peerIdInput, setPeerIdInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'files'>('chat');
  const [unreadFileCount, setUnreadFileCount] = useState(0);
  const [messages, setMessages] = useState<Array<{id: string; text: string; sender: 'me' | 'peer'; timestamp: Date}>>([]);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [transferredFiles, setTransferredFiles] = useState<Array<{
    name: string;
    size: number;
    url: string;
    type: 'sent' | 'received';
    timestamp: Date;
  }>>([]);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const lastMicToggleRef = useRef<number>(0);

  const {
    isConnected,
    connectionState,
    remoteStream,
    sendMessage,
    sendFile,
    startVoiceChat,
    stopVoiceChat,
    connectToPeer,
    localPeerId,
    remotePeerId,
    helperConnected,
  } = useWebRTCP2P({
    onMessage: (msg) => {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        text: msg.text,
        sender: 'peer',
        timestamp: new Date(),
      }]);
      if (activeTab !== 'chat') {
        // Play notification sound or show toast
        toast.info('New message received');
      }
    },
    onFileReceive: (file) => {
      const blob = new Blob([file.data], { type: file.type });
      const url = URL.createObjectURL(blob);
      
      setTransferredFiles(prev => [...prev, {
        name: file.name,
        size: file.size,
        url,
        type: 'received',
        timestamp: new Date(),
      }]);
      
      if (activeTab !== 'files') {
        setUnreadFileCount(prev => prev + 1);
      }
      
      toast.success(`File received: ${file.name}`);
    },
    onPeerConnected: () => {
      toast.success('Peer connected!');
    },
    onPeerDisconnected: () => {
      toast.error('Peer disconnected');
      setIsMicOn(false);
      setAudioStream(null);
    },
    onRemoteStream: (stream) => {
      if (stream && remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
      }
    },
    onHelperConnected: (peerId) => {
      console.log('Helper connected, PeerID:', peerId);
      toast.success('P2P Helper connected');
    },
  });

  useEffect(() => {
    if (remoteStream && remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (activeTab === 'files') {
      setUnreadFileCount(0);
    }
  }, [activeTab]);

  const handleCopyPeerId = () => {
    navigator.clipboard.writeText(localPeerId);
    setCopied(true);
    toast.success('Peer ID copied!');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleConnect = () => {
    if (!peerIdInput.trim()) {
      toast.error('Please enter a Peer ID');
      return;
    }
    
    connectToPeer(peerIdInput.trim());
    toast.info('Connecting to peer...');
  };

  const handleSendMessage = (text: string) => {
    if (!isConnected) {
      toast.error('Not connected to peer');
      return;
    }

    const message = {
      text,
      timestamp: new Date().toISOString(),
    };

    sendMessage(message);
    
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      text,
      sender: 'me',
      timestamp: new Date(),
    }]);
  };

  const handleSendFile = async (file: File) => {
    if (!isConnected) {
      toast.error('Not connected to peer');
      return;
    }

    try {
      await sendFile(file, {
        onProgress: (progress) => {
          console.log('Upload progress:', progress);
        }
      });
      
      const url = URL.createObjectURL(file);
      setTransferredFiles(prev => [...prev, {
        name: file.name,
        size: file.size,
        url,
        type: 'sent',
        timestamp: new Date(),
      }]);
      
      toast.success('File sent!');
    } catch (error) {
      toast.error('Failed to send file');
    }
  };

  const handleToggleMic = async () => {
    const now = Date.now();
    if (now - lastMicToggleRef.current < 3000) {
      toast.info('Please wait a moment');
      return;
    }
    lastMicToggleRef.current = now;
    
    if (!isConnected) {
      toast.error('Connect to a peer first');
      return;
    }
    
    if (!isMicOn) {
      try {
        const stream = await startVoiceChat();
        setAudioStream(stream);
        setIsMicOn(true);
        toast.success('Microphone enabled');
        
        if (remoteStream && remoteAudioRef.current && !isSpeakerMuted) {
          remoteAudioRef.current.muted = false;
        }
      } catch (error) {
        toast.error('Failed to access microphone');
      }
    } else {
      stopVoiceChat();
      setAudioStream(null);
      setIsMicOn(false);
      toast.info('Microphone disabled');
    }
  };

  const handleToggleSpeaker = () => {
    if (remoteAudioRef.current) {
      const newMutedState = !isSpeakerMuted;
      remoteAudioRef.current.muted = newMutedState;
      setIsSpeakerMuted(newMutedState);
      toast.info(newMutedState ? 'Speaker muted' : 'Speaker unmuted');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
                <Share2 className="w-5 h-5 text-black" />
              </div>
              <div>
                <h1 className="text-xl font-bold">SECURE.LINK P2P</h1>
                <p className="text-xs text-muted-foreground">
                  {helperConnected ? (
                    <span className="flex items-center gap-1 text-green-500">
                      <Wifi className="w-3 h-3" /> Helper Connected
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-red-500">
                      <WifiOff className="w-3 h-3" /> Helper Offline
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 flex flex-col gap-4">
        {/* Connection Setup */}
        {!isConnected && (
          <Card className="p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold mb-2">Your Peer ID</h2>
              <div className="flex gap-2">
                <Input
                  value={localPeerId || 'Waiting for helper...'}
                  readOnly
                  className="font-mono text-sm"
                  data-testid="input-local-peerid"
                />
                <Button
                  onClick={handleCopyPeerId}
                  disabled={!localPeerId}
                  data-testid="button-copy-peerid"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Share this ID with someone to let them connect to you
              </p>
            </div>

            <div className="border-t pt-4">
              <h2 className="text-lg font-semibold mb-2">Connect to Peer</h2>
              <div className="flex gap-2">
                <Input
                  value={peerIdInput}
                  onChange={(e) => setPeerIdInput(e.target.value)}
                  placeholder="Paste remote Peer ID here..."
                  className="font-mono text-sm"
                  disabled={!helperConnected}
                  data-testid="input-remote-peerid"
                />
                <Button
                  onClick={handleConnect}
                  disabled={!helperConnected || !peerIdInput.trim()}
                  data-testid="button-connect-peer"
                >
                  Connect
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {!helperConnected && (
                  <span className="text-yellow-500">
                    ⚠ Start the P2P helper application first
                  </span>
                )}
              </p>
            </div>

            <div className="bg-muted/30 p-4 rounded-lg">
              <h3 className="font-medium mb-2">How to use P2P mode:</h3>
              <ol className="text-sm space-y-1 list-decimal list-inside">
                <li>Download and run the P2P helper app</li>
                <li>Copy your Peer ID and share it</li>
                <li>Paste their Peer ID and click Connect</li>
                <li>Start chatting, voice, or file transfers</li>
              </ol>
              <p className="text-xs text-muted-foreground mt-2">
                ✓ No IP addresses exposed • ✓ No TURN servers • ✓ Fully encrypted
              </p>
            </div>
          </Card>
        )}

        {/* Connected UI */}
        {isConnected && (
          <div className="flex-1 flex flex-col bg-card rounded-lg border">
            <div className="border-b p-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Connected to Peer</h2>
                <p className="text-xs text-muted-foreground font-mono truncate max-w-xs">
                  {remotePeerId}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={isMicOn ? "default" : "secondary"}
                  className="rounded-full"
                  onClick={handleToggleMic}
                  data-testid="button-mic"
                >
                  {isMicOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                </Button>
                <Button
                  size="sm"
                  variant={isSpeakerMuted ? "secondary" : "default"}
                  className="rounded-full"
                  onClick={handleToggleSpeaker}
                  data-testid="button-speaker"
                >
                  {isSpeakerMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            <div className="border-b flex">
              <button
                onClick={() => setActiveTab('chat')}
                className={`flex-1 px-4 py-3 flex items-center justify-center gap-2 transition-colors ${
                  activeTab === 'chat' ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                }`}
                data-testid="tab-chat"
              >
                <MessageSquare className="w-4 h-4" />
                Chat
              </button>
              <button
                onClick={() => setActiveTab('files')}
                className={`flex-1 px-4 py-3 flex items-center justify-center gap-2 transition-colors relative ${
                  activeTab === 'files' ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                }`}
                data-testid="tab-files"
              >
                <FileText className="w-4 h-4" />
                Files
                {unreadFileCount > 0 && (
                  <span className="absolute top-2 right-4 bg-primary text-black text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                    {unreadFileCount}
                  </span>
                )}
              </button>
            </div>

            <div className="flex-1 p-4 overflow-hidden relative">
              <div className={`absolute inset-0 p-4 ${activeTab === 'chat' ? 'block' : 'hidden'}`}>
                <ChatInterface 
                  messages={messages} 
                  onSendMessage={handleSendMessage}
                  connectionState={connectionState}
                />
              </div>
              <div className={`absolute inset-0 p-4 ${activeTab === 'files' ? 'block' : 'hidden'}`}>
                <FileTransfer 
                  onSendFile={handleSendFile}
                  transferredFiles={transferredFiles}
                />
              </div>
            </div>
          </div>
        )}
      </main>

      <audio ref={remoteAudioRef} autoPlay playsInline muted />
      <DebugPanel />
    </div>
  );
}
