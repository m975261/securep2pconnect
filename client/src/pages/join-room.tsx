import { motion } from "framer-motion";
import { Scan, ArrowRight, Loader2, Keyboard, Upload } from "lucide-react";
import { useLocation } from "wouter";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { QRCodeScanner } from "@/components/qr-scanner";

export default function JoinRoom() {
  const [_, setLocation] = useLocation();
  const [loading, setLoading] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [code, setCode] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLoading(true);
      // Simulate reading QR from image
      setTimeout(() => {
        setCode("secure-room-8x92-from-image");
        setLocation("/room/secure-8x92");
      }, 1500);
    }
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
          <p className="text-muted-foreground font-mono text-sm">Authenticate via Code, QR Scan, or Upload</p>
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

          <div className="grid grid-cols-2 gap-4">
            <Button 
              variant="outline" 
              className="h-24 border-white/10 hover:bg-white/5 hover:border-primary/50 group flex flex-col items-center justify-center gap-2"
              onClick={() => setShowScanner(true)}
            >
              <div className="p-2 bg-black rounded border border-white/10 group-hover:border-primary/50 transition-colors">
                <Scan className="w-6 h-6 text-primary" />
              </div>
              <div className="flex flex-col items-center text-center">
                <span className="font-bold text-xs">Scan Camera</span>
                <span className="text-[10px] text-muted-foreground font-mono scale-90">Use device cam</span>
              </div>
            </Button>

            <Button 
              variant="outline" 
              className="h-24 border-white/10 hover:bg-white/5 hover:border-blue-500/50 group flex flex-col items-center justify-center gap-2"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="p-2 bg-black rounded border border-white/10 group-hover:border-blue-500/50 transition-colors">
                <Upload className="w-6 h-6 text-blue-500" />
              </div>
              <div className="flex flex-col items-center text-center">
                <span className="font-bold text-xs">Upload QR</span>
                <span className="text-[10px] text-muted-foreground font-mono scale-90">From image file</span>
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
    </div>
  );
}
