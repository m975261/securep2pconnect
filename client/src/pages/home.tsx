import { motion } from "framer-motion";
import { Shield, Users, Lock, ArrowRight, Languages } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import bgImage from "@assets/generated_images/dark_abstract_digital_security_network_background.png";

export default function Home() {
  const [language, setLanguage] = useState<'en' | 'ar'>('en');

  const translations = {
    en: {
      appName: 'SECURE.LINK',
      tagline: 'End-to-End Encrypted P2P Communication Node.',
      noTraces: 'No Servers. No Traces.',
      createRoom: 'Create Room',
      createDesc: 'Start a secure session',
      joinRoom: 'Join Room',
      joinDesc: 'Enter code or scan QR',
      version: 'V2.0.1 • WEBRTC • AES-256-GCM',
    },
    ar: {
      appName: 'SECURE.LINK',
      tagline: 'اتصال نظير إلى نظير مشفر من طرف إلى طرف.',
      noTraces: 'بدون خوادم. بدون آثار.',
      createRoom: 'إنشاء غرفة',
      createDesc: 'بدء جلسة آمنة',
      joinRoom: 'الانضمام لغرفة',
      joinDesc: 'أدخل الرمز أو امسح رمز الاستجابة',
      version: 'V2.0.1 • WEBRTC • AES-256-GCM',
    },
  };

  const t = translations[language];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      {/* Background */}
      <div 
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: `url(${bgImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: 0.4
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/90 to-background z-0" />

      {/* Language Toggle - Top Right */}
      <div className="absolute top-4 right-4 z-20">
        <Button
          size="sm"
          variant="outline"
          className="border-white/10 bg-white/5 hover:bg-white/10 gap-1"
          onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
          data-testid="button-language"
        >
          <Languages className="w-4 h-4" />
          <span className="text-xs">{language === 'en' ? 'AR' : 'EN'}</span>
        </Button>
      </div>

      <div className="relative z-10 w-full max-w-md px-6 space-y-12">
        {/* Hero */}
        <div className="text-center space-y-6">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="inline-flex items-center justify-center p-4 rounded-full bg-primary/10 border border-primary/20 text-primary mb-4"
          >
            <Shield className="w-8 h-8" />
          </motion.div>
          
          <motion.h1 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="text-4xl md:text-5xl font-bold tracking-tighter text-white"
          >
            {t.appName.split('.')[0]}<span className="text-primary">.{t.appName.split('.')[1]}</span>
          </motion.h1>
          
          <motion.p 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-muted-foreground font-mono text-sm"
          >
            {t.tagline}
            <br />{t.noTraces}
          </motion.p>
        </div>

        {/* Actions */}
        <div className="space-y-4">
          <Link href="/create">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full group relative overflow-hidden rounded-lg bg-white/5 border border-white/10 p-6 hover:border-primary/50 hover:bg-primary/5 transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded bg-black text-primary">
                    <Users className="w-6 h-6" />
                  </div>
                  <div className="text-left">
                    <h3 className="font-bold text-white">{t.createRoom}</h3>
                    <p className="text-xs text-muted-foreground font-mono">{t.createDesc}</p>
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
            </motion.button>
          </Link>

          <Link href="/join">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full group relative overflow-hidden rounded-lg bg-white/5 border border-white/10 p-6 hover:border-accent/50 hover:bg-accent/5 transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded bg-black text-accent">
                    <Lock className="w-6 h-6" />
                  </div>
                  <div className="text-left">
                    <h3 className="font-bold text-white">{t.joinRoom}</h3>
                    <p className="text-xs text-muted-foreground font-mono">{t.joinDesc}</p>
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-accent transition-colors" />
              </div>
            </motion.button>
          </Link>
        </div>

        {/* Footer */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center"
        >
          <p className="text-[10px] font-mono text-white/20">
            V2.0.1 • WEBRTC • AES-256-GCM
          </p>
        </motion.div>
      </div>
    </div>
  );
}
