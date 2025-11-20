import { motion } from "framer-motion";
import { Shield, Users, Lock, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import bgImage from "@assets/generated_images/dark_abstract_digital_security_network_background.png";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden">
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
            SECURE<span className="text-primary">.LINK</span>
          </motion.h1>
          
          <motion.p 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-muted-foreground font-mono text-sm"
          >
            End-to-End Encrypted P2P Communication Node.
            <br />No Servers. No Traces.
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
                    <h3 className="font-bold text-white">Create Room</h3>
                    <p className="text-xs text-muted-foreground font-mono">Start a secure session</p>
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
                    <h3 className="font-bold text-white">Join Room</h3>
                    <p className="text-xs text-muted-foreground font-mono">Enter code or scan QR</p>
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
