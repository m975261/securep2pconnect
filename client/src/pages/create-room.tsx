import { motion } from "framer-motion";
import { Lock, ArrowRight, Loader2, KeyRound, Home } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useState } from "react";
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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!nickname.trim()) {
      toast.error('Please enter your nickname');
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
      setLocation(`/room/${data.roomId}?nickname=${encodeURIComponent(nickname.trim())}&creator=true`);
    } catch (error) {
      console.error('Error creating room:', error);
      toast.error('Failed to create room. Please try again.');
      setLoading(false);
    }
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

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold mb-2">Initialize Session</h1>
          <p className="text-muted-foreground font-mono text-sm">Configure your secure environment</p>
        </div>

        <Card className="bg-card/50 backdrop-blur-md border-white/10 p-6">
          <form onSubmit={handleCreate} className="space-y-6">
            
            <div className="space-y-4">
              <div>
                <Label className="text-sm mb-2 block">Your Nickname</Label>
                <Input 
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="Enter your nickname"
                  className="bg-black/20 border-white/10 focus:border-primary/50"
                  data-testid="input-nickname"
                  maxLength={20}
                  required
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg bg-white/5 border border-white/5">
                <div className="space-y-0.5">
                  <Label className="text-base">Password Protection</Label>
                  <p className="text-xs text-muted-foreground">Require a key to enter</p>
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
                      placeholder="Enter session password"
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
                    GENERATE KEYS & ENTER <ArrowRight className="w-4 h-4" />
                  </span>
                )}
              </Button>
            </div>
          </form>
        </Card>

        <p className="mt-8 text-center text-xs text-muted-foreground/50 font-mono">
          By creating a room you agree to P2P connection protocols.
        </p>
      </motion.div>
    </div>
  );
}
