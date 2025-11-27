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
import { HelperPrompt } from "@/components/helper-prompt";

export default function JoinRoom() {
  const [_, setLocation] = useLocation();
  const [loading, setLoading] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const searchParams = new URLSearchParams(window.location.search);
  const roomFromUrl = searchParams.get('room') || '';
  const [code, setCode] = useState(roomFromUrl);
  const [nickname, setNickname] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [showHelperPrompt, setShowHelperPrompt] = useState(false);
  const [helperPeerId, setHelperPeerId] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [language, setLanguage] = useState<'en' | 'ar'>(() => {
    return (localStorage.getItem('app-language') as 'en' | 'ar') || 'en';
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
      backToHome: 'BACK TO HOME',
      joinSession: 'Join Session',
      authenticateVia: 'Authenticate via Code, QR Scan, or Upload',
      enterRoomCode: 'Enter room code (e.g. A1B2C3)',
      yourNickname: 'Your nickname',
      enterRoomPassword: 'Enter room password',
      connect: 'CONNECT',
      orAuthWith: 'Or authenticate with',
      scanCamera: 'Scan Camera',
      useDeviceCam: 'Use device cam',
      uploadQr: 'Upload QR',
      fromImageFile: 'From image file',
      pleaseEnterNickname: 'Please enter your nickname',
      roomNotFound: 'Room not found',
      failedToJoin: 'Failed to join room',
      qrReadSuccess: 'QR code read successfully!',
      noQrFound: 'No QR code found in image',
      attemptsRemaining: 'attempts remaining',
    },
    ar: {
      backToHome: 'العودة للرئيسية',
      joinSession: 'الانضمام للجلسة',
      authenticateVia: 'المصادقة عبر الرمز أو المسح أو التحميل',
      enterRoomCode: 'أدخل رمز الغرفة (مثال: A1B2C3)',
      yourNickname: 'اسمك المستعار',
      enterRoomPassword: 'أدخل كلمة مرور الغرفة',
      connect: 'اتصال',
      orAuthWith: 'أو المصادقة بواسطة',
      scanCamera: 'مسح الكاميرا',
      useDeviceCam: 'استخدام كاميرا الجهاز',
      uploadQr: 'تحميل رمز QR',
      fromImageFile: 'من ملف صورة',
      pleaseEnterNickname: 'الرجاء إدخال اسمك المستعار',
      roomNotFound: 'الغرفة غير موجودة',
      failedToJoin: 'فشل الانضمام للغرفة',
      qrReadSuccess: 'تم قراءة رمز QR بنجاح!',
      noQrFound: 'لم يتم العثور على رمز QR في الصورة',
      attemptsRemaining: 'محاولات متبقية',
    },
  };

  const t = translations[language];

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !nickname.trim()) {
      if (!nickname.trim()) {
        toast.error(t.pleaseEnterNickname);
      }
      return;
    }
    
    // Show helper prompt before joining
    setShowHelperPrompt(true);
  };

  const handleHelperConnected = async (connectedPeerId: string) => {
    setHelperPeerId(connectedPeerId);
    setShowHelperPrompt(false);
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
          toast.error(data.error);
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

      setLocation(`/room/${code}?nickname=${encodeURIComponent(nickname.trim())}&mode=p2p&creatorPeerId=${data.creatorPeerId || ''}`);
    } catch (error) {
      console.error('Error joining room:', error);
      toast.error(t.failedToJoin);
      setLoading(false);
    }
  };

  const handleScan = (data: string) => {
    setShowScanner(false);
    setCode(data);
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
          const roomCode = qrCode.data.split('/').pop() || '';
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
      </motion.div>

      {/* Helper Prompt Modal */}
      <HelperPrompt
        open={showHelperPrompt}
        onHelperConnected={handleHelperConnected}
        onCancel={() => setShowHelperPrompt(false)}
      />
    </div>
  );
}
