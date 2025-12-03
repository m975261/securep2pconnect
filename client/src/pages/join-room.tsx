import { motion } from "framer-motion";
import { Scan, ArrowRight, Loader2, Keyboard, Upload, Home, KeyRound, Languages } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { QRCodeScanner } from "@/components/qr-scanner";
import { toast } from "sonner";
import jsQR from "jsqr";
import { type TurnConfig } from "@/components/turn-config-modal";

export default function JoinRoom() {
  const [_, setLocation] = useLocation();
  const [loading, setLoading] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const searchParams = new URLSearchParams(window.location.search);
  const roomFromUrl = searchParams.get('room') || '';
  const [code, setCode] = useState(roomFromUrl);
  const [nickname, setNickname] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [checkingRoom, setCheckingRoom] = useState(false);
  const [roomChecked, setRoomChecked] = useState(false);
  const [password, setPassword] = useState("");
  const [, setTurnConfig] = useState<TurnConfig | null>(() => {
    const stored = localStorage.getItem('turn-config');
    return stored ? JSON.parse(stored) : null;
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [language, setLanguage] = useState<'en' | 'ar'>(() => {
    return (localStorage.getItem('app-language') as 'en' | 'ar') || 'en';
  });
  
  // Check if room requires password when code is available
  useEffect(() => {
    const checkRoomPassword = async () => {
      if (!code || code.length !== 6) {
        setRoomChecked(false);
        setNeedsPassword(false);
        return;
      }
      
      setCheckingRoom(true);
      try {
        const response = await fetch(`/api/rooms/${code}`);
        if (response.ok) {
          const data = await response.json();
          setNeedsPassword(data.hasPassword);
          setRoomChecked(true);
        } else {
          setRoomChecked(false);
        }
      } catch {
        setRoomChecked(false);
      }
      setCheckingRoom(false);
    };
    
    checkRoomPassword();
  }, [code]);

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
      backToHome: 'BACK TO HOME',
      joinSession: 'Join Session',
      joiningRoom: 'Joining Room',
      authenticateVia: 'Authenticate via Code, QR Scan, or Upload',
      enterYourNickname: 'Enter your nickname to join',
      enterRoomCode: 'Enter room code (e.g. A1B2C3)',
      yourNickname: 'Your nickname',
      enterRoomPassword: 'Enter room password',
      connect: 'CONNECT',
      join: 'JOIN',
      orAuthWith: 'Or authenticate with',
      scanCamera: 'Scan Camera',
      useDeviceCam: 'Use device cam',
      uploadQr: 'Upload QR',
      fromImageFile: 'From image file',
      pleaseEnterNickname: 'Please enter your nickname',
      roomNotFound: 'Room not found',
      roomFull: 'Session is full. Maximum 2 users allowed.',
      failedToJoin: 'Failed to join room',
      qrReadSuccess: 'QR code read successfully!',
      noQrFound: 'No QR code found in image',
      attemptsRemaining: 'attempts remaining',
      checkingRoom: 'Checking room...',
      passwordRequired: 'This room requires a password',
    },
    ar: {
      backToHome: 'العودة للرئيسية',
      joinSession: 'الانضمام للجلسة',
      joiningRoom: 'الانضمام للغرفة',
      authenticateVia: 'المصادقة عبر الرمز أو المسح أو التحميل',
      enterYourNickname: 'أدخل اسمك المستعار للانضمام',
      enterRoomCode: 'أدخل رمز الغرفة (مثال: A1B2C3)',
      yourNickname: 'اسمك المستعار',
      enterRoomPassword: 'أدخل كلمة مرور الغرفة',
      connect: 'اتصال',
      join: 'انضمام',
      orAuthWith: 'أو المصادقة بواسطة',
      scanCamera: 'مسح الكاميرا',
      useDeviceCam: 'استخدام كاميرا الجهاز',
      uploadQr: 'تحميل رمز QR',
      fromImageFile: 'من ملف صورة',
      pleaseEnterNickname: 'الرجاء إدخال اسمك المستعار',
      roomNotFound: 'الغرفة غير موجودة',
      roomFull: 'الجلسة ممتلئة. الحد الأقصى مستخدمان فقط.',
      failedToJoin: 'فشل الانضمام للغرفة',
      qrReadSuccess: 'تم قراءة رمز QR بنجاح!',
      noQrFound: 'لم يتم العثور على رمز QR في الصورة',
      attemptsRemaining: 'محاولات متبقية',
      checkingRoom: 'جاري التحقق من الغرفة...',
      passwordRequired: 'هذه الغرفة تتطلب كلمة مرور',
    },
  };

  const t = translations[language];

  const joinRoom = async () => {
    setLoading(true);

    try {
      const response = await fetch(`/api/rooms/${code}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: password || undefined,
          nickname: nickname.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 403) {
          if (data.code === 'ROOM_FULL') {
            toast.error(t.roomFull);
            // Redirect to home after showing error
            setTimeout(() => setLocation('/'), 2000);
          } else {
            toast.error(data.error);
          }
        } else if (response.status === 401) {
          setNeedsPassword(true);
          toast.error(data.error + (data.attemptsRemaining ? ` (${data.attemptsRemaining} ${t.attemptsRemaining})` : ''));
        } else if (response.status === 404) {
          toast.error(t.roomNotFound);
        } else {
          toast.error(t.failedToJoin);
        }
        setLoading(false);
        return;
      }

      if (data.hasPassword && !password && !needsPassword) {
        setNeedsPassword(true);
        setLoading(false);
        return;
      }

      // Store TURN config from join response locally for WebRTC
      if (data.turnConfig) {
        console.log('[Join] Received TURN config from server:', 
          'urls:', data.turnConfig.urls?.length || 0,
          'stunUrls:', data.turnConfig.stunUrls?.length || 0,
          'hasCredentials:', !!data.turnConfig.username);
        localStorage.setItem('turn-config', JSON.stringify(data.turnConfig));
        setTurnConfig(data.turnConfig);
      } else {
        console.warn('[Join] No TURN config received from server!');
      }

      setLocation(`/room/${code}?nickname=${encodeURIComponent(nickname.trim())}`);
    } catch (error) {
      console.error('Error joining room:', error);
      toast.error(t.failedToJoin);
      setLoading(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !nickname.trim()) {
      if (!nickname.trim()) {
        toast.error(t.pleaseEnterNickname);
      }
      return;
    }
    
    await joinRoom();
  };

  // Extract room code from various formats:
  // - Full URL: https://xxx.replit.dev/join-room?room=ABCDEF
  // - Path: /join-room?room=ABCDEF
  // - Old format: /room/ABCDEF
  // - Direct code: ABCDEF
  const extractRoomCode = (input: string): string => {
    const trimmed = input.trim();
    
    // Check for ?room= query parameter (new format)
    const urlMatch = trimmed.match(/[?&]room=([A-Z0-9]+)/i);
    if (urlMatch) {
      return urlMatch[1].toUpperCase();
    }
    
    // Check for /room/CODE path (old format)
    const pathMatch = trimmed.match(/\/room\/([A-Z0-9]+)/i);
    if (pathMatch) {
      return pathMatch[1].toUpperCase();
    }
    
    // Assume it's a direct room code (6 character alphanumeric)
    const codeMatch = trimmed.match(/^([A-Z0-9]{6})$/i);
    if (codeMatch) {
      return codeMatch[1].toUpperCase();
    }
    
    // Fallback: try to extract last segment that looks like a code
    const segments = trimmed.split(/[/?&=]/);
    for (let i = segments.length - 1; i >= 0; i--) {
      if (/^[A-Z0-9]{6}$/i.test(segments[i])) {
        return segments[i].toUpperCase();
      }
    }
    
    return trimmed.toUpperCase();
  };

  const handleScan = (data: string) => {
    setShowScanner(false);
    const roomCode = extractRoomCode(data);
    setCode(roomCode);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = image.width;
        canvas.height = image.height;
        ctx.drawImage(image, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qrCode = jsQR(imageData.data, imageData.width, imageData.height);

        if (qrCode) {
          const roomCode = extractRoomCode(qrCode.data);
          setCode(roomCode);
          toast.success(t.qrReadSuccess);
        } else {
          toast.error(t.noQrFound);
        }
      };
      image.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 relative" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <div className="absolute top-4 left-4">
        <Link href="/">
          <Button variant="ghost" className="text-muted-foreground hover:text-white gap-2" data-testid="button-back">
            <Home className="w-4 h-4" />
            {t.backToHome}
          </Button>
        </Link>
      </div>

      {/* Language Toggle - Top Right */}
      <div className="absolute top-4 right-4">
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
      </div>

      {showScanner && (
        <QRCodeScanner 
          onScan={handleScan} 
          onClose={() => setShowScanner(false)} 
        />
      )}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        {/* Simplified view when room code is provided */}
        {roomFromUrl || roomChecked ? (
          <>
            <div className="mb-8 text-center">
              <h1 className="text-3xl font-bold mb-2">{t.joiningRoom}</h1>
              <div className="inline-block px-4 py-2 bg-accent/20 rounded-lg border border-accent/30 mb-3">
                <span className="font-mono text-xl tracking-widest text-accent">{code}</span>
              </div>
              <p className="text-muted-foreground font-mono text-sm">{t.enterYourNickname}</p>
            </div>

            <Card className="bg-card/50 backdrop-blur-md border-white/10 p-6">
              {checkingRoom ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="animate-spin mr-2" />
                  <span className="text-muted-foreground">{t.checkingRoom}</span>
                </div>
              ) : (
                <form onSubmit={handleJoin} className="space-y-4">
                  <div className="relative">
                    <Input 
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      placeholder={t.yourNickname}
                      className="bg-black/20 border-white/10 focus:border-accent/50 text-center text-lg"
                      data-testid="input-nickname"
                      maxLength={20}
                      required
                      autoFocus
                    />
                  </div>

                  {needsPassword && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      className="overflow-hidden"
                    >
                      <p className="text-xs text-muted-foreground mb-2 text-center">{t.passwordRequired}</p>
                      <div className="relative">
                        <KeyRound className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input 
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={t.enterRoomPassword}
                          className="pl-9 bg-black/20 border-white/10 focus:border-primary/50 font-mono"
                          data-testid="input-password"
                        />
                      </div>
                    </motion.div>
                  )}

                  <Button 
                    type="submit" 
                    disabled={loading || !nickname.trim() || (needsPassword && !password)}
                    className="w-full bg-accent text-accent-foreground hover:bg-accent/90 font-bold text-lg py-6"
                    data-testid="button-connect"
                  >
                    {loading ? <Loader2 className="animate-spin" /> : (
                      <>
                        {t.join}
                        <ArrowRight className="ml-2 w-5 h-5" />
                      </>
                    )}
                  </Button>
                </form>
              )}
            </Card>
          </>
        ) : (
          /* Full view when no room code is provided */
          <>
            <div className="mb-8 text-center">
              <h1 className="text-3xl font-bold mb-2">{t.joinSession}</h1>
              <p className="text-muted-foreground font-mono text-sm">{t.authenticateVia}</p>
            </div>

            <div className="grid gap-6">
              <Card className="bg-card/50 backdrop-blur-md border-white/10 p-6">
                <form onSubmit={handleJoin} className="space-y-4">
                  <div className="relative">
                    <Keyboard className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input 
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      placeholder={t.enterRoomCode}
                      className="pl-9 bg-black/20 border-white/10 focus:border-accent/50 font-mono uppercase tracking-widest"
                      data-testid="input-code"
                    />
                  </div>

                  <div className="relative">
                    <Input 
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      placeholder={t.yourNickname}
                      className="bg-black/20 border-white/10 focus:border-accent/50"
                      data-testid="input-nickname"
                      maxLength={20}
                      required
                    />
                  </div>

                  {needsPassword && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      className="overflow-hidden"
                    >
                      <div className="relative">
                        <KeyRound className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input 
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={t.enterRoomPassword}
                          className="pl-9 bg-black/20 border-white/10 focus:border-primary/50 font-mono"
                          data-testid="input-password"
                        />
                      </div>
                    </motion.div>
                  )}

                  <Button 
                    type="submit" 
                    disabled={loading || !code || !nickname.trim()}
                    className="w-full bg-accent text-accent-foreground hover:bg-accent/90 font-bold"
                    data-testid="button-connect"
                  >
                    {loading ? <Loader2 className="animate-spin" /> : t.connect}
                  </Button>
                </form>
              </Card>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-white/10" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">{t.orAuthWith}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Button 
                  variant="outline" 
                  className="h-24 border-white/10 hover:bg-white/5 hover:border-primary/50 group flex flex-col items-center justify-center gap-2"
                  onClick={() => setShowScanner(true)}
                  data-testid="button-scan"
                >
                  <div className="p-2 bg-black rounded border border-white/10 group-hover:border-primary/50 transition-colors">
                    <Scan className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex flex-col items-center text-center">
                    <span className="font-bold text-xs">{t.scanCamera}</span>
                    <span className="text-[10px] text-muted-foreground font-mono scale-90">{t.useDeviceCam}</span>
                  </div>
                </Button>

                <Button 
                  variant="outline" 
                  className="h-24 border-white/10 hover:bg-white/5 hover:border-blue-500/50 group flex flex-col items-center justify-center gap-2"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="button-upload"
                >
                  <div className="p-2 bg-black rounded border border-white/10 group-hover:border-blue-500/50 transition-colors">
                    <Upload className="w-6 h-6 text-blue-500" />
                  </div>
                  <div className="flex flex-col items-center text-center">
                    <span className="font-bold text-xs">{t.uploadQr}</span>
                    <span className="text-[10px] text-muted-foreground font-mono scale-90">{t.fromImageFile}</span>
                  </div>
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    className="hidden" 
                    accept="image/*"
                    onChange={handleFileUpload}
                  />
                </Button>
              </div>
            </div>
          </>
        )}
      </motion.div>

    </div>
  );
}
