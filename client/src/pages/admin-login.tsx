import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export default function AdminLogin() {
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [requires2FA, setRequires2FA] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          username, 
          password, 
          totpCode: totpCode || undefined 
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Login failed");
        setLoading(false);
        return;
      }

      if (data.requires2FA) {
        setRequires2FA(true);
        setLoading(false);
        toast.info("Enter your 2FA code");
        return;
      }

      toast.success("Login successful");
      
      if (data.forcePasswordChange) {
        setLocation("/admin/change-password");
      } else {
        setLocation("/admin/dashboard");
      }
    } catch (error) {
      toast.error("Login failed");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-gray-900/90 border-cyan-500/20">
        <CardHeader>
          <CardTitle className="text-2xl text-cyan-400 font-['Space_Grotesk']">
            Admin Login
          </CardTitle>
          <CardDescription className="text-gray-400">
            Enter your credentials to access the admin panel
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <Label htmlFor="username" className="text-gray-300">Username</Label>
              <Input
                id="username"
                data-testid="input-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="bg-gray-800/50 border-gray-700 text-white"
                required
              />
            </div>
            
            <div>
              <Label htmlFor="password" className="text-gray-300">Password</Label>
              <Input
                id="password"
                data-testid="input-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-gray-800/50 border-gray-700 text-white"
                required
              />
            </div>

            {requires2FA && (
              <div>
                <Label htmlFor="totp" className="text-gray-300">2FA Code</Label>
                <Input
                  id="totp"
                  data-testid="input-2fa"
                  type="text"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="000000"
                  maxLength={6}
                  className="bg-gray-800/50 border-gray-700 text-white"
                  required
                />
              </div>
            )}

            <Button
              type="submit"
              data-testid="button-login"
              disabled={loading}
              className="w-full bg-cyan-500 hover:bg-cyan-600 text-gray-900 font-['Space_Grotesk']"
            >
              {loading ? "Logging in..." : "Login"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
