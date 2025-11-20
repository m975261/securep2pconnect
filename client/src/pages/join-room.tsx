import { motion } from "framer-motion";
import { Scan, ArrowRight, Loader2, Keyboard } from "lucide-react";
import { useLocation } from "wouter";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { QRCodeScanner } from "@/components/qr-scanner";

export default function JoinRoom() {
  const [_, setLocation] = useLocation();
  const [loading, setLoading] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [code, setCode] = useState("");

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code) return;
    
    setLoading(true);
    // Simulate connection
    setTimeout(() => {
      setLocation("/room/secure-8x92");
    }, 1500);
  };

  const handleScan = (data: string) => {
    setShowScanner(false);
    setCode(data);
    setLoading(true);
    setTimeout(() => {
      setLocation("/room/secure-8x92");
    }, 1000);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
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
          <h1 className="text-3xl font-bold mb-2">Join Session</h1>
          <p className="text-muted-foreground font-mono text-sm">Authenticate via Code or QR</p>
        </div>

        <div className="grid gap-6">
          <Card className="bg-card/50 backdrop-blur-md border-white/10 p-6">
            <form onSubmit={handleJoin} className="space-y-4">
              <div className="relative">
                <Keyboard className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input 
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Enter room code (e.g. 8x92)"
                  className="pl-9 bg-black/20 border-white/10 focus:border-accent/50 font-mono uppercase tracking-widest"
                />
              </div>
              <Button 
                type="submit" 
                disabled={loading || !code}
                className="w-full bg-accent text-accent-foreground hover:bg-accent/90 font-bold"
              >
                {loading ? <Loader2 className="animate-spin" /> : "CONNECT"}
              </Button>
            </form>
          </Card>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-white/10" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or authenticate with</span>
            </div>
          </div>

          <Button 
            variant="outline" 
            className="h-16 border-white/10 hover:bg-white/5 hover:border-primary/50 group"
            onClick={() => setShowScanner(true)}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-black rounded border border-white/10 group-hover:border-primary/50">
                <Scan className="w-5 h-5 text-primary" />
              </div>
              <div className="flex flex-col items-start">
                <span className="font-bold">Scan QR Passkey</span>
                <span className="text-[10px] text-muted-foreground font-mono">Use camera to authenticate</span>
              </div>
            </div>
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
