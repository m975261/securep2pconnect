import { motion, AnimatePresence } from "framer-motion";
import { 
  Mic, MicOff, PhoneOff, 
  Share2, MessageSquare, FileText, Copy, Check, Lock, Volume2, VolumeX, Download, Languages
} from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import QRCode from "react-qr-code";
import { ChatInterface } from "@/components/chat-interface";
import { FileTransfer } from "@/components/file-transfer";
import { DebugPanel } from "@/components/debug-panel";
import { useWebRTC, type TurnConfig } from "@/lib/webrtc";
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
  const [peerId] = useState(() => {
    const stored = localStorage.getItem(`creator_${roomId}`);
    if (stored) return stored;
    const newId = Math.random().toString(36).substring(7);
    localStorage.setItem(`creator_${roomId}`, newId);
    return newId;
  });
  const [nickname, setNickname] = useState(nicknameFromUrl);
  const [peerNickname, setPeerNickname] = useState<string>("");
  const [isMicOn, setIsMicOn] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'files'>('chat');
  const [unreadFileCount, setUnreadFileCount] = useState(0);
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
  const [hasPassword, setHasPassword] = useState(false);
  const [needsNickname, setNeedsNickname] = useState(!nicknameFromUrl);
  const [shareLink, setShareLink] = useState('');
  const [transferredFiles, setTransferredFiles] = useState<Array<{
    name: string;
    size: number;
    url: string;
    type: 'sent' | 'received';
    timestamp: Date;
    senderName?: string;
  }>>([]);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const [remoteAudioMuted, setRemoteAudioMuted] = useState(true);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const lastMicToggleRef = useRef<number>(0); // Debounce voice toggle
  const [language, setLanguage] = useState<'en' | 'ar'>(() => {
    return (localStorage.getItem('app-language') as 'en' | 'ar') || 'en';
  });
  const [turnConfig] = useState<TurnConfig | null>(() => {
    const stored = localStorage.getItem('turn-config');
    return stored ? JSON.parse(stored) : null;
  });

  useEffect(() => {
    const handleLanguageChange = (e: CustomEvent) => {
      setLanguage(e.detail);
    };
    window.addEventListener('languageChange', handleLanguageChange as any);
    return () => window.removeEventListener('languageChange', handleLanguageChange as any);
  }, []);

  const handleLanguageChange = (newLang: 'en' | 'ar') => {
    setLanguage(newLang);
    localStorage.setItem('app-language', newLang);
    window.dispatchEvent(new CustomEvent('languageChange', { detail: newLang }));
  };

  const translations = {
    en: {
      appName: 'SECURE.LINK',
      connected: 'connected',
      waiting: 'waiting',
      encrypted: 'AES-256 ENCRYPTED',
      chatTab: 'Chat',
      fileTab: 'File Transfer',
      exitSession: 'EXIT SESSION',
      exit: 'EXIT',
      invitePeer: 'INVITE PEER',
      password: 'PASSWORD',
      passwordEnabled: 'PASSWORD ENABLED',
      noPassword: 'NO PASSWORD',
      roomPassword: 'ROOM PASSWORD',
      passwordProtection: 'Password Protection',
      roomProtected: 'Room is password protected',
      roomNotProtected: 'Room is not protected',
      changePassword: 'Change Password',
      enterNewPassword: 'Enter new password',
      updatePassword: 'Update Password',
      removePassword: 'Remove Password',
      setPassword: 'Set Password',
      enterPassword: 'Enter password',
      enablePassword: 'Enable Password Protection',
      sessionKeys: 'SESSION ACCESS KEYS',
      saveQr: 'SAVE QR',
      sharedLink: 'SHARED SECRET LINK',
    },
    ar: {
      appName: 'SECURE.LINK',
      connected: 'متصل',
      waiting: 'انتظار',
      encrypted: 'مشفر AES-256',
      chatTab: 'محادثة',
      fileTab: 'نقل الملفات',
      exitSession: 'إنهاء الجلسة',
      exit: 'خروج',
      invitePeer: 'دعوة',
      password: 'كلمة المرور',
      passwordEnabled: 'كلمة المرور مفعلة',
      noPassword: 'بدون كلمة مرور',
      roomPassword: 'كلمة مرور الغرفة',
      passwordProtection: 'حماية كلمة المرور',
      roomProtected: 'الغرفة محمية بكلمة مرور',
      roomNotProtected: 'الغرفة غير محمية',
      changePassword: 'تغيير كلمة المرور',
      enterNewPassword: 'أدخل كلمة مرور جديدة',
      updatePassword: 'تحديث كلمة المرور',
      removePassword: 'إزالة كلمة المرور',
      setPassword: 'تعيين كلمة المرور',
      enterPassword: 'أدخل كلمة المرور',
      enablePassword: 'تفعيل حماية كلمة المرور',
      sessionKeys: 'مفاتيح الوصول للجلسة',
      saveQr: 'حفظ الرمز',
      sharedLink: 'رابط المشاركة السري',
    },
  };

  const t = translations[language];

  useEffect(() => {
    if (typeof window !== 'undefined' && roomId) {
      setShareLink(`${window.location.origin}/room/${roomId}`);
    }
  }, [roomId]);

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
        setHasPassword(data.hasPassword || false);
        
        // Only set passwordVerified to true if we already have a nickname
        if (!needsNickname) {
          setPasswordVerified(true);
        }
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
  }, [roomId, peerId, setLocation, needsNickname]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!nickname.trim()) {
      toast.error('Please enter your nickname');
      return;
    }
    
    try {
      const response = await fetch(`/api/rooms/${roomId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          password: passwordRequired ? password : undefined,
          nickname: nickname.trim(),
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
      setNeedsNickname(false);
      if (data.isCreator) {
        setIsCreator(true);
      }
      
      // Update URL with nickname
      const newUrl = `/room/${roomId}?nickname=${encodeURIComponent(nickname.trim())}`;
      window.history.replaceState({}, '', newUrl);
      
      toast.success(passwordRequired ? 'Password verified' : 'Joined room');
    } catch (error) {
      console.error('Error verifying password:', error);
      toast.error('Failed to verify password');
    }
  };

  const onMessage = useCallback((message: any) => {
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      text: message.text,
      sender: 'peer',
      timestamp: new Date(),
      senderName: message.senderName || peerNickname || 'Peer',
    }]);
  }, [peerNickname]);

  const onFileReceive = useCallback((file: any) => {
    const senderName = file.fromNickname || 'Peer';
    toast.success(`Received file from ${senderName}: ${file.name}`);
    const blob = new Blob([file.data], { type: file.type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    setTransferredFiles(prev => [...prev, {
      name: file.name,
      size: file.size || file.data.byteLength,
      url,
      type: 'received' as const,
      timestamp: new Date(),
      senderName,
    }]);
    
    // Increment unread count if user is on chat tab
    setActiveTab(currentTab => {
      if (currentTab === 'chat') {
        setUnreadFileCount(prev => prev + 1);
      }
      return currentTab;
    });
  }, []);

  const onPeerConnected = useCallback((peerInfo?: { nickname?: string }) => {
    if (peerInfo?.nickname) {
      setPeerNickname(peerInfo.nickname);
      toast.success(`${peerInfo.nickname} connected!`);
    } else {
      toast.success('Peer connected!');
    }
  }, []);

  const onPeerDisconnected = useCallback(() => {
    toast.error('Peer disconnected');
    setPeerNickname('');
  }, []);

  const webrtcConfig = useMemo(() => ({
    roomId: passwordVerified ? roomId : '',
    peerId: passwordVerified ? peerId : '',
    nickname: passwordVerified ? nickname : '',
    turnConfig: turnConfig || undefined,
    onMessage,
    onFileReceive,
    onPeerConnected,
    onPeerDisconnected,
  }), [passwordVerified, roomId, peerId, nickname, turnConfig, onMessage, onFileReceive, onPeerConnected, onPeerDisconnected]);

  const { connectionState, remoteStream, sendMessage, sendFile, startVoiceChat, stopVoiceChat } = useWebRTC(webrtcConfig);

  // Attach remote audio stream to audio element
  useEffect(() => {
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
      // Start muted to comply with autoplay policies
      remoteAudioRef.current.muted = true;
      remoteAudioRef.current.play().then(() => {
        // Auto-unmute if user has already interacted and speaker is not manually muted
        if (hasUserInteracted && remoteAudioRef.current && !isSpeakerMuted) {
          remoteAudioRef.current.muted = false;
          setRemoteAudioMuted(false);
        } else if (!hasUserInteracted) {
          // Show notification to enable audio
          toast.info('Peer audio available - click to enable', {
            duration: 5000,
            action: {
              label: 'Enable',
              onClick: () => {
                if (remoteAudioRef.current && !isSpeakerMuted) {
                  remoteAudioRef.current.muted = false;
                  setRemoteAudioMuted(false);
                  toast.success('Peer audio enabled');
                }
              }
            }
          });
        }
      }).catch(err => {
        console.error('Error playing remote audio:', err);
        toast.error('Failed to play peer audio');
      });
    }
  }, [remoteStream, hasUserInteracted, isSpeakerMuted]);

  const handleSendMessage = (text: string) => {
    const messageData = { text, senderName: nickname || 'Anonymous' };
    console.log('Sending message:', messageData);
    sendMessage(messageData);
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      text,
      sender: 'me',
      timestamp: new Date(),
      senderName: nickname || 'You',
    }]);
  };

  const handleSendFile = async (file: File, onProgress?: (progress: number) => void) => {
    const url = URL.createObjectURL(file);
    
    try {
      await sendFile(file, { onProgress });
      
      // Only add to transferredFiles after successful send
      setTransferredFiles(prev => [...prev, {
        name: file.name,
        size: file.size,
        url,
        type: 'sent' as const,
        timestamp: new Date(),
        senderName: nickname || 'You',
      }]);
    } catch (error) {
      console.error('Failed to send file:', error);
      toast.error(`Failed to send ${file.name}: Connection lost`);
      // Clean up the blob URL since we won't be using it
      URL.revokeObjectURL(url);
    }
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
        setHasPassword(true);
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

  const handleRemovePassword = async () => {
    try {
      const response = await fetch(`/api/rooms/${roomId}/password`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          createdBy: peerId,
        }),
      });

      if (response.ok) {
        toast.success('Password removed successfully!');
        setHasPassword(false);
        setShowPasswordDialog(false);
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to remove password');
      }
    } catch (error) {
      toast.error('Failed to remove password');
    }
  };

  const handleToggleMic = async () => {
    // Debounce: Prevent rapid toggling during WebRTC negotiation
    const now = Date.now();
    if (now - lastMicToggleRef.current < 3000) {
      toast.info('Please wait a moment before toggling again');
      return;
    }
    lastMicToggleRef.current = now;
    
    // Mark that user has interacted
    setHasUserInteracted(true);
    
    if (!isMicOn) {
      try {
        const stream = await startVoiceChat();
        setAudioStream(stream);
        setIsMicOn(true);
        toast.success('Microphone enabled');
        
        // Auto-unmute remote audio if it's muted due to autoplay
        if (remoteStream && remoteAudioRef.current && remoteAudioRef.current.muted && !isSpeakerMuted) {
          remoteAudioRef.current.muted = false;
          setRemoteAudioMuted(false);
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
      setRemoteAudioMuted(newMutedState);
      toast.info(newMutedState ? 'Speaker muted' : 'Speaker unmuted');
    } else {
      toast.error('No remote audio available');
    }
  };

  const copyLink = () => {
    if (shareLink) {
      navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Link copied to clipboard!');
    }
  };

  const downloadQRCode = () => {
    const svg = document.querySelector('.qr-code-svg') as SVGElement;
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    canvas.width = 256;
    canvas.height = 256;

    img.onload = () => {
      ctx?.drawImage(img, 0, 0, 256, 256);
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `secure-link-${roomId}.png`;
          a.click();
          URL.revokeObjectURL(url);
          toast.success("QR code saved!");
        }
      });
    };

    img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
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

  if ((passwordRequired || needsNickname) && !passwordVerified) {
    return (
      <div className="h-screen flex items-center justify-center bg-background p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md max-h-[90vh] overflow-y-auto"
        >
          <div className="bg-card/50 backdrop-blur-md border border-white/10 rounded-lg p-4 sm:p-8">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold mb-2">{passwordRequired ? 'Password Required' : 'Join Room'}</h2>
              <p className="text-muted-foreground text-sm">
                {passwordRequired ? 'This room is protected. Enter your details to join.' : 'Enter your nickname to join the room.'}
              </p>
            </div>
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Your Nickname</label>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="Enter your nickname"
                  className="w-full px-4 py-3 bg-black/20 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
                  data-testid="input-room-nickname"
                  autoFocus={!passwordRequired}
                  maxLength={20}
                  required
                />
              </div>
              {passwordRequired && (
                <div>
                  <label className="block text-sm font-medium mb-2">Room Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full px-4 py-3 bg-black/20 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                    data-testid="input-room-password"
                    autoFocus={!!nickname}
                    required
                  />
                </div>
              )}
              <Button
                type="submit"
                className="w-full bg-primary hover:bg-primary/90 text-black font-bold"
                data-testid="button-verify-password"
              >
                {passwordRequired ? 'Unlock Room' : 'Join Room'}
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
    <div className="h-screen flex flex-col bg-background overflow-hidden" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <header className="h-16 border-b border-white/10 bg-card/50 backdrop-blur flex items-center justify-between px-2 sm:px-4 z-20">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1 overflow-hidden">
          <span className="font-mono text-[10px] sm:text-sm font-bold tracking-wider sm:tracking-widest text-primary" data-testid="text-room-id">
            ROOM: {roomId}
          </span>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {isCreator && (
            <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
              <DialogTrigger asChild>
                <Button 
                  size="sm" 
                  variant="outline" 
                  className={`border-white/10 gap-1 sm:gap-2 ${hasPassword ? 'bg-primary/10 hover:bg-primary/20 border-primary/30' : 'bg-white/5 hover:bg-white/10'}`}
                  data-testid="button-password-toggle"
                >
                  <Lock className={`w-3 h-3 sm:w-4 sm:h-4 ${hasPassword ? 'text-primary' : ''}`} />
                  <span className="hidden sm:inline">{hasPassword ? t.passwordEnabled : t.noPassword}</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-white/10 w-[95vw] max-w-md mx-auto max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="font-mono text-sm sm:text-base">{t.roomPassword}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 sm:space-y-4 py-2 sm:py-4">
                  <div className="flex items-center justify-between p-2 sm:p-3 bg-black/20 rounded-lg border border-white/10">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <Lock className={`w-4 h-4 sm:w-5 sm:h-5 ${hasPassword ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div>
                        <p className="text-xs sm:text-sm font-medium">{t.passwordProtection}</p>
                        <p className="text-[10px] sm:text-xs text-muted-foreground">
                          {hasPassword ? t.roomProtected : t.roomNotProtected}
                        </p>
                      </div>
                    </div>
                    <div className={`w-2 h-2 rounded-full ${hasPassword ? 'bg-primary shadow-[0_0_10px_rgba(0,255,157,0.5)]' : 'bg-muted-foreground'}`} />
                  </div>
                  
                  {hasPassword ? (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs sm:text-sm font-medium mb-2">{t.changePassword}</label>
                        <Input
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder={t.enterNewPassword}
                          className="bg-black/20 border-white/10 focus:border-primary/50 text-sm"
                          data-testid="input-new-password"
                        />
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Button
                          onClick={handleSetPassword}
                          className="flex-1 bg-primary hover:bg-primary/90 text-black font-bold text-xs sm:text-sm"
                          data-testid="button-update-password"
                        >
                          {t.updatePassword}
                        </Button>
                        <Button
                          onClick={handleRemovePassword}
                          variant="destructive"
                          className="flex-1 text-xs sm:text-sm"
                          data-testid="button-remove-password"
                        >
                          {t.removePassword}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs sm:text-sm font-medium mb-2">{t.setPassword}</label>
                        <Input
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder={t.enterPassword}
                          className="bg-black/20 border-white/10 focus:border-primary/50 text-sm"
                          data-testid="input-new-password"
                        />
                      </div>
                      <Button
                        onClick={handleSetPassword}
                        className="w-full bg-primary hover:bg-primary/90 text-black font-bold text-xs sm:text-sm"
                        data-testid="button-save-password"
                      >
                        {t.enablePassword}
                      </Button>
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          )}
          
          <Button
            size="sm"
            variant="outline"
            className="border-white/10 bg-white/5 hover:bg-white/10 gap-1"
            onClick={() => handleLanguageChange(language === 'en' ? 'ar' : 'en')}
            data-testid="button-language"
          >
            <Languages className="w-4 h-4" />
            <span className="text-xs">{language === 'en' ? 'AR' : 'EN'}</span>
          </Button>

          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="border-white/10 bg-white/5 hover:bg-white/10 gap-1 sm:gap-2" data-testid="button-invite">
                <Share2 className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden sm:inline">{t.invitePeer}</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-white/10 w-[95vw] max-w-md mx-auto max-h-[85vh] overflow-y-auto p-4 sm:p-6">
              <DialogHeader className="pb-2">
                <DialogTitle className="font-mono text-xs sm:text-sm">{t.sessionKeys}</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col items-center gap-2 sm:gap-3">
                <div className="p-2 bg-white rounded-lg relative">
                  <QRCode 
                    value={shareLink || window.location.origin} 
                    size={Math.min(140, window.innerWidth - 120)}
                    className="w-full h-auto max-w-[140px] qr-code-svg"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={downloadQRCode}
                  className="border-white/10 bg-white/5 hover:bg-white/10 gap-2 font-mono text-xs"
                  data-testid="button-download-qr"
                >
                  <Download className="w-3 h-3" />
                  {t.saveQr}
                </Button>
                <div className="w-full space-y-1.5">
                  <label className="text-[10px] sm:text-xs text-muted-foreground font-mono">{t.sharedLink}</label>
                  <div className="flex gap-1.5 sm:gap-2">
                    <div className="flex-1 p-1.5 sm:p-2 bg-black/30 border border-white/10 rounded font-mono text-[9px] sm:text-xs break-all overflow-hidden">
                      {shareLink}
                    </div>
                    <Button 
                      size="icon" 
                      variant="outline" 
                      onClick={copyLink} 
                      className="shrink-0 h-8 w-8 sm:h-9 sm:w-9 p-0"
                      data-testid="button-copy-link"
                    >
                      {copied ? <Check className="w-3 h-3 sm:w-4 sm:h-4 text-primary" /> : <Copy className="w-3 h-3 sm:w-4 sm:h-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          
          <Button 
            variant="destructive" 
            size="sm"
            className="rounded-full gap-1 sm:gap-2 font-bold tracking-wider"
            onClick={() => setLocation("/")}
            data-testid="button-exit"
          >
            <PhoneOff className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden md:inline">{t.exitSession}</span>
            <span className="md:hidden text-xs">{t.exit}</span>
          </Button>
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        
        <div className="md:flex-1 shrink-0 p-2 md:p-4 flex flex-col items-center justify-start md:justify-center relative border-b md:border-b-0 md:border-r border-white/10 bg-black/20">
          <div className="w-full max-w-sm space-y-2 md:space-y-4">
            {/* App Header */}
            <div className="flex items-center justify-center gap-2 p-1.5 md:p-2 bg-card/40 border border-white/10 rounded-lg backdrop-blur-sm">
              <span className="font-mono text-xs md:text-sm font-bold tracking-wider text-primary">{t.appName}</span>
              <div className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center">
                <Lock className="w-3 h-3 md:w-4 md:h-4 text-primary" />
              </div>
            </div>

            {/* Peers in One Line */}
            <div className="p-1.5 md:p-3 bg-card/40 border border-white/10 rounded-lg backdrop-blur-sm">
              <div className="flex items-center justify-center gap-3 md:gap-6">
                {/* Current User */}
                <div className="flex flex-col items-center gap-0.5 flex-1">
                  <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center px-1" data-testid="text-my-nickname">
                    <span className="text-primary font-bold text-[10px] md:text-sm truncate max-w-full text-center">{nickname}</span>
                  </div>
                  <p className="text-[9px] md:text-xs text-muted-foreground">{t.connected}</p>
                </div>

                {/* Connection Line */}
                <div className="flex-shrink-0 w-6 md:w-8 h-0.5 bg-primary/30"></div>

                {/* Peer User */}
                <div className="flex flex-col items-center gap-0.5 flex-1">
                  <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-accent/20 border-2 border-accent flex items-center justify-center px-1" data-testid="text-peer-display-nickname">
                    <span className="text-accent font-bold text-[10px] md:text-sm truncate max-w-full text-center">{peerNickname || '?'}</span>
                  </div>
                  <p className="text-[9px] md:text-xs text-muted-foreground">{peerNickname ? t.connected : t.waiting}</p>
                </div>
              </div>
            </div>

            {/* Encryption Status */}
            <div className="flex items-center justify-center gap-1.5 p-1.5 md:p-2 bg-primary/5 border border-primary/20 rounded-lg">
              <Lock className="w-2.5 h-2.5 md:w-3 md:h-3 text-primary" />
              <span className="text-[10px] md:text-xs font-mono text-primary">{t.encrypted}</span>
            </div>

            {/* Voice Controls */}
            <div className="flex justify-center gap-2 md:gap-3">
              <Button
                size="lg"
                variant={isMicOn ? "default" : "secondary"}
                className={`rounded-full w-12 h-12 md:w-14 md:h-14 ${isMicOn ? 'bg-primary text-black hover:bg-primary/90' : ''}`}
                onClick={handleToggleMic}
                data-testid="button-mic"
              >
                {isMicOn ? <Mic className="w-4 h-4 md:w-5 md:h-5" /> : <MicOff className="w-4 h-4 md:w-5 md:h-5" />}
              </Button>
              <Button
                size="lg"
                variant={isSpeakerMuted ? "secondary" : "default"}
                className={`rounded-full w-12 h-12 md:w-14 md:h-14 ${!isSpeakerMuted ? 'bg-accent text-black hover:bg-accent/90' : ''}`}
                onClick={handleToggleSpeaker}
                data-testid="button-speaker"
              >
                {isSpeakerMuted ? <VolumeX className="w-4 h-4 md:w-5 md:h-5" /> : <Volume2 className="w-4 h-4 md:w-5 md:h-5" />}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 md:max-w-md flex flex-col bg-card/30 backdrop-blur-sm mt-4 md:mt-0">
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
              <MessageSquare className="w-4 h-4" /> {t.chatTab}
            </button>
            <button
              onClick={() => {
                setActiveTab('files');
                setUnreadFileCount(0);
              }}
              className={`flex-1 py-4 text-sm font-bold font-mono border-b-2 transition-colors flex items-center justify-center gap-2 relative ${
                activeTab === 'files' 
                  ? 'border-accent text-accent bg-accent/5' 
                  : 'border-transparent text-muted-foreground hover:text-white'
              }`}
              data-testid="tab-files"
            >
              <FileText className="w-4 h-4" /> {t.fileTab}
              {unreadFileCount > 0 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 1 }}
                  className="absolute -top-1 right-1/4 bg-accent text-black text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center shadow-lg"
                  data-testid="badge-unread-files"
                >
                  {unreadFileCount}
                </motion.span>
              )}
            </button>
          </div>

          <div className="flex-1 p-4 overflow-hidden relative">
            <div className={`absolute inset-0 p-4 ${activeTab === 'chat' ? 'block' : 'hidden'}`}>
              <ChatInterface 
                messages={messages} 
                onSendMessage={handleSendMessage}
                peerNickname={peerNickname}
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
      </main>
      
      {/* Audio element for remote peer's voice */}
      <audio ref={remoteAudioRef} autoPlay playsInline muted />
      
      {/* Debug Panel for mobile testing */}
      <DebugPanel />
    </div>
  );
}
