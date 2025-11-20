import { motion, AnimatePresence } from "framer-motion";
import { 
  Mic, MicOff, PhoneOff, 
  Share2, MessageSquare, FileText, Copy, Check
} from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import QRCode from "react-qr-code";
import { ChatInterface } from "@/components/chat-interface";
import { FileTransfer } from "@/components/file-transfer";
import { useWebRTC } from "@/lib/webrtc";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function Room() {
  const [_, setLocation] = useLocation();
  const [match, params] = useRoute("/room/:id");
  const roomId = params?.id || "";
  const [peerId] = useState(() => Math.random().toString(36).substring(7));
  const [isMicOn, setIsMicOn] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'files'>('chat');
  const [copied, setCopied] = useState(false);
  const [messages, setMessages] = useState<Array<{id: string; text: string; sender: 'me' | 'peer'; timestamp: Date}>>([]);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);

  const { connectionState, sendMessage, sendFile, startVoiceChat, stopVoiceChat } = useWebRTC({
    roomId,
    peerId,
    onMessage: (message) => {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        text: message.text,
        sender: 'peer',
        timestamp: new Date(),
      }]);
    },
    onFileReceive: (file) => {
      toast.success(`Received file: ${file.name}`);
      const blob = new Blob([file.data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
    },
    onPeerConnected: () => {
      toast.success('Peer connected!');
    },
    onPeerDisconnected: () => {
      toast.error('Peer disconnected');
    },
  });

  const handleSendMessage = (text: string) => {
    sendMessage({ text });
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      text,
      sender: 'me',
      timestamp: new Date(),
    }]);
  };

  const handleToggleMic = async () => {
    if (!isMicOn) {
      try {
        const stream = await startVoiceChat();
        setAudioStream(stream);
        setIsMicOn(true);
        toast.success('Microphone enabled');
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

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Link copied to clipboard!');
  };

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <header className="h-16 border-b border-white/10 bg-card/50 backdrop-blur flex items-center justify-between px-4 z-20">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${connectionState === 'connected' ? 'bg-primary shadow-[0_0_10px_rgba(0,255,157,0.5)]' : 'bg-yellow-500 animate-pulse'}`} />
            <span className="font-mono text-sm font-bold tracking-widest" data-testid="text-status">
              {connectionState === 'connected' ? 'SECURE_LINK_ACTIVE' : 'HANDSHAKE_INIT...'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="border-white/10 bg-white/5 hover:bg-white/10 gap-2" data-testid="button-invite">
                <Share2 className="w-4 h-4" />
                <span className="hidden sm:inline">INVITE PEER</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-white/10 sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="font-mono">SESSION ACCESS KEYS</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col items-center gap-6 py-4">
                <div className="p-4 bg-white rounded-lg">
                  <QRCode value={window.location.href} size={180} />
                </div>
                <div className="w-full space-y-2">
                  <label className="text-xs text-muted-foreground font-mono">SHARED SECRET LINK</label>
                  <div className="flex gap-2">
                    <div className="flex-1 p-2 bg-black/30 border border-white/10 rounded font-mono text-xs truncate">
                      {window.location.href}
                    </div>
                    <Button size="icon" variant="outline" onClick={copyLink}>
                      {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          
          <Button 
            variant="destructive" 
            className="rounded-full h-10 px-4 gap-2 font-bold tracking-wider"
            onClick={() => setLocation("/")}
            data-testid="button-exit"
          >
            <PhoneOff className="w-4 h-4" />
            EXIT SESSION
          </Button>
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        
        <div className="flex-1 p-6 flex flex-col items-center justify-center relative border-b md:border-b-0 md:border-r border-white/10 bg-black/20">
          <div className="relative w-64 h-64 flex items-center justify-center">
            {[1, 2, 3].map((i) => (
              <motion.div
                key={i}
                className={`absolute inset-0 border border-primary/20 rounded-full`}
                animate={{
                  scale: isMicOn ? [1, 1.2, 1] : 1,
                  opacity: isMicOn ? [0.5, 0, 0.5] : 0.2,
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  delay: i * 0.4,
                  ease: "easeInOut"
                }}
              />
            ))}
            
            <div className="relative z-10 w-32 h-32 rounded-full bg-black border-2 border-primary/50 flex items-center justify-center shadow-[0_0_30px_rgba(0,255,157,0.2)]">
              {isMicOn ? (
                <div className="flex gap-1 items-end h-12">
                  {[...Array(5)].map((_, i) => (
                    <motion.div
                      key={i}
                      className="w-1 bg-primary"
                      animate={{ height: [10, 30, 10] }}
                      transition={{
                        duration: 0.5,
                        repeat: Infinity,
                        delay: i * 0.1,
                        repeatType: "reverse"
                      }}
                    />
                  ))}
                </div>
              ) : (
                <MicOff className="w-10 h-10 text-muted-foreground" />
              )}
            </div>
          </div>

          <div className="mt-12 flex gap-4">
            <Button
              size="lg"
              variant={isMicOn ? "default" : "secondary"}
              className={`rounded-full w-16 h-16 ${isMicOn ? 'bg-primary text-black hover:bg-primary/90' : ''}`}
              onClick={handleToggleMic}
              data-testid="button-mic"
            >
              {isMicOn ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
            </Button>
          </div>

          <div className="absolute bottom-6 text-center">
             <p className="text-xs font-mono text-muted-foreground/50">
               AES-256 ENCRYPTION ENABLED
             </p>
          </div>
        </div>

        <div className="flex-1 md:max-w-md flex flex-col bg-card/30 backdrop-blur-sm">
          <div className="flex border-b border-white/10">
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex-1 py-4 text-sm font-bold font-mono border-b-2 transition-colors flex items-center justify-center gap-2 ${
                activeTab === 'chat' 
                  ? 'border-primary text-primary bg-primary/5' 
                  : 'border-transparent text-muted-foreground hover:text-white'
              }`}
              data-testid="tab-chat"
            >
              <MessageSquare className="w-4 h-4" /> CHAT_STREAM
            </button>
            <button
              onClick={() => setActiveTab('files')}
              className={`flex-1 py-4 text-sm font-bold font-mono border-b-2 transition-colors flex items-center justify-center gap-2 ${
                activeTab === 'files' 
                  ? 'border-accent text-accent bg-accent/5' 
                  : 'border-transparent text-muted-foreground hover:text-white'
              }`}
              data-testid="tab-files"
            >
              <FileText className="w-4 h-4" /> DATA_TRANSFER
            </button>
          </div>

          <div className="flex-1 p-4 overflow-hidden relative">
             <AnimatePresence mode="wait">
               {activeTab === 'chat' ? (
                 <motion.div 
                   key="chat"
                   initial={{ opacity: 0, x: 20 }}
                   animate={{ opacity: 1, x: 0 }}
                   exit={{ opacity: 0, x: -20 }}
                   className="h-full"
                 >
                   <ChatInterface messages={messages} onSendMessage={handleSendMessage} />
                 </motion.div>
               ) : (
                 <motion.div 
                   key="files"
                   initial={{ opacity: 0, x: 20 }}
                   animate={{ opacity: 1, x: 0 }}
                   exit={{ opacity: 0, x: -20 }}
                   className="h-full"
                 >
                   <FileTransfer onSendFile={sendFile} />
                 </motion.div>
               )}
             </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}
