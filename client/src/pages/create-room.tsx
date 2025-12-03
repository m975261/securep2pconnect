import { motion } from "framer-motion";
import { Lock, ArrowRight, Loader2, KeyRound, Home, Languages, Server, AlertTriangle, CheckCircle2, Settings } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { TurnConfigModal, type TurnConfig } from "@/components/turn-config-modal";

export default function CreateRoom() {
  const [_, setLocation] = useLocation();
  const [loading, setLoading] = useState(false);
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [peerId] = useState(() => Math.random().toString(36).substring(7));
  const [showTurnConfig, setShowTurnConfig] = useState(false);
  const [turnConfig, setTurnConfig] = useState<TurnConfig | null>(() => {
    const stored = localStorage.getItem('turn-config');
    return stored ? JSON.parse(stored) : null;
  });
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
      agreement: 'By creating a room you agree to relay connection protocols.',
      pleaseEnterNickname: 'Please enter your nickname',
      failedToCreate: 'Failed to create room. Please try again.',
      turnServerRequired: 'TURN Server Required',
      configureTurnServer: 'Configure your TURN relay server for secure connections',
      clickToConfigure: 'Click to Configure',
      turnServerConfigured: 'TURN Server Configured',
      connectedTo: 'Connected to',
      change: 'Change',
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
      agreement: 'من خلال إنشاء غرفة فإنك توافق على بروتوكولات الاتصال عبر المُرحّل.',
      pleaseEnterNickname: 'الرجاء إدخال اسمك المستعار',
      failedToCreate: 'فشل في إنشاء الغرفة. يرجى المحاولة مرة أخرى.',
      turnServerRequired: 'خادم TURN مطلوب',
      configureTurnServer: 'قم بتكوين خادم TURN للاتصالات الآمنة',
      clickToConfigure: 'انقر للتكوين',
      turnServerConfigured: 'تم تكوين خادم TURN',
      connectedTo: 'متصل بـ',
      change: 'تغيير',
    },
  };

  const t = translations[language];

  const [pendingCreate, setPendingCreate] = useState(false);

  const createRoom = async () => {
    if (!turnConfig) {
      toast.error(t.turnServerRequired);
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
          turnConfig: {
            urls: turnConfig.urls,
            username: turnConfig.username,
            credential: turnConfig.credential,
            stunUrls: turnConfig.stunUrls,
          },
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create room');
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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!nickname.trim()) {
      toast.error(t.pleaseEnterNickname);
      return;
    }

    // Check if TURN configuration exists
    if (!turnConfig) {
      setPendingCreate(true);
      setShowTurnConfig(true);
      return;
    }
    
    await createRoom();
  };

  const handleTurnConfigured = async (config: TurnConfig) => {
    setTurnConfig(config);
    setShowTurnConfig(false);
    toast.success("TURN server configured successfully");
    
    // If user was trying to create a room, proceed automatically
    if (pendingCreate && nickname.trim()) {
      setPendingCreate(false);
      await createRoom();
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

        {/* TURN Server Configuration Card */}
        <Card 
          className={`mb-4 p-4 cursor-pointer transition-all ${
            turnConfig 
              ? 'bg-green-500/10 border-green-500/30 hover:border-green-500/50' 
              : 'bg-orange-500/10 border-orange-500/30 hover:border-orange-500/50'
          }`}
          onClick={() => setShowTurnConfig(true)}
          data-testid="card-turn-config"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {turnConfig ? (
                <div className="p-2 rounded-full bg-green-500/20">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                </div>
              ) : (
                <div className="p-2 rounded-full bg-orange-500/20">
                  <AlertTriangle className="w-5 h-5 text-orange-500" />
                </div>
              )}
              <div>
                <h3 className={`font-semibold text-sm ${turnConfig ? 'text-green-400' : 'text-orange-400'}`}>
                  {turnConfig ? t.turnServerConfigured : t.turnServerRequired}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {turnConfig 
                    ? `${t.connectedTo}: ${turnConfig.urls[0]?.replace(/^turns?:/, '').split(':')[0] || 'server'}`
                    : t.configureTurnServer
                  }
                </p>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={turnConfig ? 'text-green-400 hover:text-green-300' : 'text-orange-400 hover:text-orange-300'}
              data-testid="button-change-turn"
            >
              {turnConfig ? (
                <span className="flex items-center gap-1">
                  <Settings className="w-4 h-4" />
                  {t.change}
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <Server className="w-4 h-4" />
                  {t.clickToConfigure}
                </span>
              )}
            </Button>
          </div>
        </Card>

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

      {/* TURN Configuration Modal */}
      <TurnConfigModal
        open={showTurnConfig}
        onConfigured={handleTurnConfigured}
        onCancel={() => {
          setShowTurnConfig(false);
          setPendingCreate(false);
        }}
        language={language}
      />
    </div>
  );
}
