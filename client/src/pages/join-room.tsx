import { motion } from "framer-motion";
import { Scan, ArrowRight, Loader2, Keyboard, Upload, Home, KeyRound } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { QRCodeScanner } from "@/components/qr-scanner";
import { toast } from "sonner";
import jsQR from "jsqr";

export default function JoinRoom() {
  const [_, setLocation] = useLocation();
  const [loading, setLoading] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [code, setCode] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code) return;
    
    setLoading(true);

    try {
      const response = await fetch(`/api/rooms/${code}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: password || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 403) {
          toast.error(data.error);
        } else if (response.status === 401) {
          setNeedsPassword(true);
          toast.error(data.error + (data.attemptsRemaining ? ` (${data.attemptsRemaining} attempts remaining)` : ''));
        } else if (response.status === 404) {
          toast.error('Room not found');
        } else {
          toast.error('Failed to join room');
        }
        setLoading(false);
        return;
      }

      if (data.hasPassword && !password && !needsPassword) {
        setNeedsPassword(true);
        setLoading(false);
        return;
      }

      setLocation(`/room/${code}`);
    } catch (error) {
      console.error('Error joining room:', error);
      toast.error('Failed to join room. Please try again.');
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
          toast.success('QR code read successfully!');
        } else {
          toast.error('No QR code found in image');
        }
      };
      image.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 relative">
      <div className="absolute top-4 left-4">
        <Link href="/">
          <Button variant="ghost" className="text-muted-foreground hover:text-white gap-2" data-testid="button-back">
            <Home className="w-4 h-4" />
            BACK TO HOME
          </Button>
        </Link>
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
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="Enter room code (e.g. A1B2C3)"
                  className="pl-9 bg-black/20 border-white/10 focus:border-accent/50 font-mono uppercase tracking-widest"
                  data-testid="input-code"
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
                      placeholder="Enter room password"
                      className="pl-9 bg-black/20 border-white/10 focus:border-primary/50 font-mono"
                      data-testid="input-password"
                    />
                  </div>
                </motion.div>
              )}

              <Button 
                type="submit" 
                disabled={loading || !code}
                className="w-full bg-accent text-accent-foreground hover:bg-accent/90 font-bold"
                data-testid="button-connect"
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
              data-testid="button-scan"
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
              data-testid="button-upload"
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
