import { motion } from "framer-motion";
import { Lock, ArrowRight, Loader2, KeyRound, Home, Languages } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

export default function CreateRoom() {
  const [_, setLocation] = useLocation();
  const [loading, setLoading] = useState(false);
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [peerId] = useState(() => Math.random().toString(36).substring(7));
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
      initSession: 'Initialize Session',
      configureEnv: 'Configure your secure environment',
      yourNickname: 'Your Nickname',
      enterNickname: 'Enter your nickname',
      passwordProtection: 'Password Protection',
      requireKey: 'Require a key to enter',
      enterSessionPassword: 'Enter session password',
      generateKeys: 'GENERATE KEYS & ENTER',
      agreement: 'By creating a room you agree to P2P connection protocols.',
      pleaseEnterNickname: 'Please enter your nickname',
      failedToCreate: 'Failed to create room. Please try again.',
    },
    ar: {
      backToHome: 'العودة للرئيسية',
      initSession: 'تهيئة الجلسة',
      configureEnv: 'قم بتكوين بيئتك الآمنة',
      yourNickname: 'اسمك المستعار',
      enterNickname: 'أدخل اسمك المستعار',
      passwordProtection: 'حماية كلمة المرور',
      requireKey: 'يتطلب مفتاح للدخول',
      enterSessionPassword: 'أدخل كلمة مرور الجلسة',
      generateKeys: 'إنشاء المفاتيح والدخول',
      agreement: 'من خلال إنشاء غرفة فإنك توافق على بروتوكولات اتصال P2P.',
      pleaseEnterNickname: 'الرجاء إدخال اسمك المستعار',
      failedToCreate: 'فشل في إنشاء الغرفة. يرجى المحاولة مرة أخرى.',
    },
  };

  const t = translations[language];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!nickname.trim()) {
      toast.error(t.pleaseEnterNickname);
      return;
    }
    
    setLoading(true);

    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: passwordEnabled && password ? password : undefined,
          createdBy: peerId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create room');
      }

      const data = await response.json();
      localStorage.setItem(`creator_${data.roomId}`, peerId);
      setLocation(`/room/${data.roomId}?nickname=${encodeURIComponent(nickname.trim())}`);
    } catch (error) {
      console.error('Error creating room:', error);
      toast.error(t.failedToCreate);
      setLoading(false);
    }
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

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold mb-2">{t.initSession}</h1>
          <p className="text-muted-foreground font-mono text-sm">{t.configureEnv}</p>
        </div>

        <Card className="bg-card/50 backdrop-blur-md border-white/10 p-6">
          <form onSubmit={handleCreate} className="space-y-6">
            
            <div className="space-y-4">
              <div>
                <Label className="text-sm mb-2 block">{t.yourNickname}</Label>
                <Input 
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder={t.enterNickname}
                  className="bg-black/20 border-white/10 focus:border-primary/50"
                  data-testid="input-nickname"
                  maxLength={20}
                  required
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-white/5 border border-white/5">
                <div className="space-y-0.5">
                  <Label className="text-base">{t.passwordProtection}</Label>
                  <p className="text-xs text-muted-foreground">{t.requireKey}</p>
                </div>
                <Switch 
                  checked={passwordEnabled}
                  onCheckedChange={setPasswordEnabled}
                  data-testid="switch-password"
                />
              </div>

              {passwordEnabled && (
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
                      placeholder={t.enterSessionPassword}
                      className="pl-9 bg-black/20 border-white/10 focus:border-primary/50 font-mono"
                      data-testid="input-password"
                    />
                  </div>
                </motion.div>
              )}
            </div>

            <div className="pt-4">
              <Button 
                type="submit" 
                disabled={loading || !nickname.trim()}
                className="w-full h-12 bg-primary text-primary-foreground hover:bg-primary/90 font-bold tracking-wide"
                data-testid="button-create"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <span className="flex items-center gap-2">
                    {t.generateKeys} <ArrowRight className="w-4 h-4" />
                  </span>
                )}
              </Button>
            </div>
          </form>
        </Card>

        <p className="mt-8 text-center text-xs text-muted-foreground/50 font-mono">
          {t.agreement}
        </p>
      </motion.div>
    </div>
  );
}
