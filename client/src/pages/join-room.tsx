import { motion } from "framer-motion";
import { Scan, ArrowRight, Loader2, Keyboard, Upload, Home, Lock, AlertTriangle, Timer } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { QRCodeScanner } from "@/components/qr-scanner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function JoinRoom() {
  const [_, setLocation] = useLocation();
  const [loading, setLoading] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<'code' | 'password'>('code');
  const [error, setError] = useState("");
  const [lockoutTime, setLockoutTime] = useState<Date | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check for existing lockout on mount
  useEffect(() => {
    const storedLockout = localStorage.getItem("room_lockout");
    if (storedLockout) {
      const lockout = new Date(storedLockout);
      if (lockout > new Date()) {
        setLockoutTime(lockout);
      } else {
        localStorage.removeItem("room_lockout");
      }
    }
  }, []);

  const getRemainingTime = () => {
    if (!lockoutTime) return "";
    const diff = lockoutTime.getTime() - new Date().getTime();
    const minutes = Math.floor(diff / 60000);
    return `${minutes} minutes`;
  };

  const handleCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code) return;
    if (lockoutTime) return;

    setLoading(true);
    // Simulate checking if room exists and needs password
    setTimeout(() => {
      setLoading(false);
      setStep('password');
      setError("");
    }, 1000);
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (lockoutTime) return;

    setLoading(true);
    
    // Simulate password check
    setTimeout(() => {
      setLoading(false);
      
      // Mock password check (pass is '123456')
      if (password === '123456') {
        setLocation("/room/secure-8x92");
      } else {
        const attempts = parseInt(localStorage.getItem("attempts") || "0") + 1;
        localStorage.setItem("attempts", attempts.toString());
        
        if (attempts >= 5) {
          const lockout = new Date(new Date().getTime() + 60 * 60 * 1000); // 1 hour
          localStorage.setItem("room_lockout", lockout.toISOString());
          localStorage.setItem("attempts", "0"); // Reset attempts after lockout
          setLockoutTime(lockout);
          setError("Too many failed attempts. Access denied for 1 hour.");
        } else {
          setError(`Invalid password. ${5 - attempts} attempts remaining.`);
          setPassword("");
        }
      }
    }, 1000);
  };

  const handleScan = (data: string) => {
    setShowScanner(false);
    setCode(data);
    // If scanned, assume we still need password if it's a protected room
    // For this mock, we'll jump to password step
    setStep('password'); 
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLoading(true);
      setTimeout(() => {
        setLoading(false);
        setCode("secure-room-8x92-from-image");
        setStep('password');
      }, 1500);
    }
  };

  if (lockoutTime) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 relative">
        <div className="absolute top-4 left-4">
          <Link href="/">
            <Button variant="ghost" className="text-muted-foreground hover:text-white gap-2">
              <Home className="w-4 h-4" />
              BACK TO HOME
            </Button>
          </Link>
        </div>
        <Card className="max-w-md w-full p-8 border-destructive/50 bg-destructive/5 text-center space-y-6">
           <div className="w-20 h-20 bg-destructive/20 rounded-full flex items-center justify-center mx-auto">
             <Timer className="w-10 h-10 text-destructive" />
           </div>
           <div>
             <h2 className="text-2xl font-bold text-destructive mb-2">Access Denied</h2>
             <p className="text-muted-foreground">
               Too many failed attempts. Security protocols have locked this terminal.
             </p>
             <p className="mt-4 font-mono text-sm text-white">
               Try again in: <span className="text-destructive">{getRemainingTime()}</span>
             </p>
           </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 relative">
      <div className="absolute top-4 left-4">
        <Link href="/">
          <Button variant="ghost" className="text-muted-foreground hover:text-white gap-2">
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
          <p className="text-muted-foreground font-mono text-sm">
            {step === 'code' ? 'Authenticate via Code, QR Scan, or Upload' : 'Enter Session Key'}
          </p>
        </div>

        <div className="grid gap-6">
          <Card className="bg-card/50 backdrop-blur-md border-white/10 p-6">
            <form onSubmit={step === 'code' ? handleCodeSubmit : handlePasswordSubmit} className="space-y-4">
              
              {step === 'code' ? (
                <motion.div 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="relative"
                >
                  <Keyboard className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input 
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Enter room code (e.g. 8x92)"
                    className="pl-9 bg-black/20 border-white/10 focus:border-accent/50 font-mono uppercase tracking-widest"
                    autoFocus
                  />
                </motion.div>
              ) : (
                <motion.div 
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="space-y-4"
                >
                   <div className="p-2 bg-primary/10 border border-primary/20 rounded text-xs text-primary text-center font-mono">
                     ROOM FOUND: {code.toUpperCase()}
                   </div>
                   <div className="relative">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input 
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter room password"
                      className="pl-9 bg-black/20 border-white/10 focus:border-primary/50 font-mono"
                      autoFocus
                    />
                  </div>
                </motion.div>
              )}

              {error && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                  <Alert variant="destructive" className="bg-destructive/10 border-destructive/20">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-xs font-mono ml-2">
                      {error}
                    </AlertDescription>
                  </Alert>
                </motion.div>
              )}

              <Button 
                type="submit" 
                disabled={loading || (step === 'code' ? !code : !password)}
                className={`w-full font-bold ${
                  step === 'code' 
                    ? 'bg-accent text-accent-foreground hover:bg-accent/90' 
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                }`}
              >
                {loading ? (
                  <Loader2 className="animate-spin" /> 
                ) : (
                  step === 'code' ? "CONNECT" : "UNLOCK SESSION"
                )}
              </Button>
            </form>
          </Card>

          {step === 'code' && (
            <>
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
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
