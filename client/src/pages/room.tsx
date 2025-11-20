import { motion, AnimatePresence } from "framer-motion";
import { 
  Mic, MicOff, PhoneOff, 
  Share2, MessageSquare, FileText, Copy, Check, Lock
} from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const searchParams = new URLSearchParams(window.location.search);
  const nicknameFromUrl = searchParams.get('nickname') || '';
  const [peerId] = useState(() => Math.random().toString(36).substring(7));
  const [nickname] = useState(nicknameFromUrl);
  const [peerNickname, setPeerNickname] = useState<string>("");
  const [isMicOn, setIsMicOn] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'files'>('chat');
  const [copied, setCopied] = useState(false);
  const [messages, setMessages] = useState<Array<{id: string; text: string; sender: 'me' | 'peer'; timestamp: Date; senderName?: string}>>([]);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordVerified, setPasswordVerified] = useState(false);
  const [checkingPassword, setCheckingPassword] = useState(true);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [isCreator, setIsCreator] = useState(false);

  useEffect(() => {
    const checkRoomPassword = async () => {
      try {
        const response = await fetch(`/api/rooms/${roomId}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            createdBy: peerId,
          }),
        });

        if (!response.ok) {
          if (response.status === 404) {
            toast.error("Room not found");
            setLocation("/");
            return;
          }
          
          const data = await response.json();
          if (response.status === 401) {
            setPasswordRequired(true);
            setCheckingPassword(false);
            return;
          }
        }

        const data = await response.json();
        if (data.isCreator) {
          setIsCreator(true);
        }
        
        setPasswordVerified(true);
        setCheckingPassword(false);
      } catch (error) {
        console.error("Error checking room:", error);
        toast.error("Failed to check room");
        setLocation("/");
      }
    };
    
    if (roomId) {
      checkRoomPassword();
    }
  }, [roomId, peerId, setLocation]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const response = await fetch(`/api/rooms/${roomId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          password,
          createdBy: peerId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 403) {
          toast.error(data.error);
        } else if (response.status === 401) {
          toast.error(data.error + (data.attemptsRemaining ? ` (${data.attemptsRemaining} attempts remaining)` : ''));
        } else {
          toast.error('Invalid password');
        }
        return;
      }

      setPasswordVerified(true);
      if (data.isCreator) {
        setIsCreator(true);
      }
      toast.success('Password verified');
    } catch (error) {
      console.error('Error verifying password:', error);
      toast.error('Failed to verify password');
    }
  };

  const { connectionState, sendMessage, sendFile, startVoiceChat, stopVoiceChat } = useWebRTC({
    roomId: passwordVerified ? roomId : '',
    peerId: passwordVerified ? peerId : '',
    nickname: passwordVerified ? nickname : '',
    onMessage: (message: any) => {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        text: message.text,
        sender: 'peer',
        timestamp: new Date(),
        senderName: peerNickname || 'Peer',
      }]);
    },
    onFileReceive: (file: any) => {
      toast.success(`Received file: ${file.name}`);
      const blob = new Blob([file.data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
    },
    onPeerConnected: (peerInfo?: { nickname?: string }) => {
      if (peerInfo?.nickname) {
        setPeerNickname(peerInfo.nickname);
        toast.success(`${peerInfo.nickname} connected!`);
      } else {
        toast.success('Peer connected!');
      }
    },
    onPeerDisconnected: () => {
      toast.error('Peer disconnected');
      setPeerNickname('');
    },
  });

  const handleSendMessage = (text: string) => {
    sendMessage({ text });
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      text,
      sender: 'me',
      timestamp: new Date(),
      senderName: nickname || 'You',
    }]);
  };

  const handleSetPassword = async () => {
    if (!newPassword.trim()) {
      toast.error('Please enter a password');
      return;
    }

    try {
      const response = await fetch(`/api/rooms/${roomId}/password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          password: newPassword,
          createdBy: peerId,
        }),
      });

      if (response.ok) {
        toast.success('Password set successfully!');
        setShowPasswordDialog(false);
        setNewPassword('');
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to set password');
      }
    } catch (error) {
      toast.error('Failed to set password');
    }
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

  if (checkingPassword) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Checking room...</p>
        </div>
      </div>
    );
  }

  if (passwordRequired && !passwordVerified) {
    return (
      <div className="h-screen flex items-center justify-center bg-background p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md"
        >
          <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-lg p-8">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold mb-2">Password Required</h2>
              <p className="text-muted-foreground text-sm">This room is protected. Enter the password to join.</p>
            </div>
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Room Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className="w-full px-4 py-3 bg-black/20 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                  data-testid="input-room-password"
                  autoFocus
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-primary hover:bg-primary/90 text-black font-bold"
                data-testid="button-verify-password"
              >
                Unlock Room
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full border-white/10 hover:bg-white/5"
                onClick={() => setLocation("/")}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
            </form>
          </div>
        </motion.div>
      </div>
    );
  }

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
          {peerNickname && (
            <span className="text-sm text-muted-foreground" data-testid="text-peer-nickname">
              Connected with: <span className="text-primary font-medium">{peerNickname}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isCreator && (
            <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="border-white/10 bg-white/5 hover:bg-white/10 gap-2" data-testid="button-set-password">
                  <Lock className="w-4 h-4" />
                  <span className="hidden sm:inline">SET PASSWORD</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-white/10 sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="font-mono">PROTECT THIS ROOM</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">New Password</label>
                    <Input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter password"
                      className="bg-black/20 border-white/10 focus:border-primary/50"
                      data-testid="input-new-password"
                    />
                  </div>
                  <Button
                    onClick={handleSetPassword}
                    className="w-full bg-primary hover:bg-primary/90 text-black font-bold"
                    data-testid="button-save-password"
                  >
                    Save Password
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
          
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
