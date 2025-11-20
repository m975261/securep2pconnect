import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Shield, LogOut, Wifi, WifiOff } from "lucide-react";
import type { PeerConnection } from "@shared/schema";

export default function AdminDashboard() {
  const [, setLocation] = useLocation();
  const [peers, setPeers] = useState<PeerConnection[]>([]);
  const [twoFAEnabled, setTwoFAEnabled] = useState(false);
  const [showTwoFADialog, setShowTwoFADialog] = useState(false);
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch("/api/admin/status");
        if (!response.ok) {
          setLocation("/admin/login");
          return;
        }
      } catch {
        setLocation("/admin/login");
        return;
      }
    };
    
    checkAuth();
    loadPeers();
    const interval = setInterval(loadPeers, 5000);
    return () => clearInterval(interval);
  }, [setLocation]);

  const loadPeers = async () => {
    try {
      const response = await fetch("/api/admin/peers");
      const data = await response.json();
      setPeers(data.peers || []);
    } catch (error) {
      console.error("Failed to load peers:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } catch (error) {
      console.error("Logout error:", error);
    }
    setLocation("/admin/login");
  };

  const handleEnable2FA = async () => {
    if (!password) {
      toast.error("Please enter your password");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/admin/2fa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Failed to enable 2FA");
        setLoading(false);
        return;
      }

      setQrCode(data.qrCode);
      setSecret(data.secret);
      setLoading(false);
    } catch (error) {
      toast.error("Failed to enable 2FA");
      setLoading(false);
    }
  };

  const handleVerify2FA = async () => {
    if (!totpCode || totpCode.length !== 6) {
      toast.error("Please enter a valid 6-digit code");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/admin/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totpCode, secret }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Invalid code");
        setLoading(false);
        return;
      }

      toast.success("2FA enabled successfully");
      setTwoFAEnabled(true);
      setShowTwoFADialog(false);
      setQrCode("");
      setSecret("");
      setTotpCode("");
      setPassword("");
      setLoading(false);
    } catch (error) {
      toast.error("Failed to verify code");
      setLoading(false);
    }
  };

  const handleDisable2FA = async () => {
    try {
      await fetch("/api/admin/2fa/disable", { method: "POST" });
      toast.success("2FA disabled");
      setTwoFAEnabled(false);
    } catch (error) {
      toast.error("Failed to disable 2FA");
    }
  };

  const activePeers = peers.filter(p => !p.disconnectedAt);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-cyan-400 font-['Space_Grotesk']">
              Admin Dashboard
            </h1>
            <p className="text-gray-400 mt-1">Monitor peer connections and security</p>
          </div>
          <div className="flex gap-2">
            <Dialog open={showTwoFADialog} onOpenChange={setShowTwoFADialog}>
              <DialogTrigger asChild>
                <Button 
                  data-testid="button-2fa-toggle"
                  variant="outline" 
                  className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                >
                  <Shield className="mr-2 h-4 w-4" />
                  {twoFAEnabled ? "2FA Enabled" : "Enable 2FA"}
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-gray-900 border-cyan-500/20 w-[95vw] max-w-md mx-auto max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="text-cyan-400 text-sm sm:text-base">Setup Two-Factor Authentication</DialogTitle>
                  <DialogDescription className="text-gray-400 text-xs sm:text-sm">
                    {!qrCode ? "Enter your password to generate a QR code" : "Scan the QR code with Google Authenticator"}
                  </DialogDescription>
                </DialogHeader>

                {!qrCode ? (
                  <div className="space-y-3 sm:space-y-4">
                    <div>
                      <Label htmlFor="password" className="text-gray-300 text-xs sm:text-sm">Password</Label>
                      <Input
                        id="password"
                        data-testid="input-2fa-password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="bg-gray-800/50 border-gray-700 text-white text-sm"
                      />
                    </div>
                    <Button
                      data-testid="button-generate-qr"
                      onClick={handleEnable2FA}
                      disabled={loading}
                      className="w-full bg-cyan-500 hover:bg-cyan-600 text-gray-900 text-xs sm:text-sm"
                    >
                      Generate QR Code
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3 sm:space-y-4">
                    <div className="flex justify-center p-3 sm:p-4 bg-white rounded">
                      <img 
                        src={qrCode} 
                        alt="QR Code" 
                        data-testid="img-qr-code"
                        className="w-full h-auto max-w-[200px]"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-300 text-xs sm:text-sm">Or enter this code manually:</Label>
                      <code className="block mt-2 p-2 bg-gray-800 rounded text-cyan-400 text-[10px] sm:text-sm break-all">
                        {secret}
                      </code>
                    </div>
                    <div>
                      <Label htmlFor="totp" className="text-gray-300 text-xs sm:text-sm">Enter 6-digit code</Label>
                      <Input
                        id="totp"
                        data-testid="input-verify-2fa"
                        type="text"
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value)}
                        placeholder="000000"
                        maxLength={6}
                        className="bg-gray-800/50 border-gray-700 text-white text-sm"
                      />
                    </div>
                    <Button
                      data-testid="button-verify-2fa"
                      onClick={handleVerify2FA}
                      disabled={loading}
                      className="w-full bg-cyan-500 hover:bg-cyan-600 text-gray-900 text-xs sm:text-sm"
                    >
                      Verify & Enable
                    </Button>
                  </div>
                )}
              </DialogContent>
            </Dialog>

            <Button
              data-testid="button-logout"
              onClick={handleLogout}
              variant="outline"
              className="border-red-500/30 text-red-400 hover:bg-red-500/10"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>

        <Card className="bg-gray-900/90 border-cyan-500/20">
          <CardHeader>
            <CardTitle className="text-xl text-cyan-400 font-['Space_Grotesk']">
              Active Connections ({activePeers.length})
            </CardTitle>
            <CardDescription className="text-gray-400">
              Real-time peer connection monitoring
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {activePeers.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No active connections</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full" data-testid="table-peers">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left p-3 text-cyan-400 font-['Space_Grotesk']">Nickname</th>
                        <th className="text-left p-3 text-cyan-400 font-['Space_Grotesk']">Room ID</th>
                        <th className="text-left p-3 text-cyan-400 font-['Space_Grotesk']">Location</th>
                        <th className="text-left p-3 text-cyan-400 font-['Space_Grotesk']">IP Address</th>
                        <th className="text-left p-3 text-cyan-400 font-['Space_Grotesk']">Device</th>
                        <th className="text-left p-3 text-cyan-400 font-['Space_Grotesk']">Connected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activePeers.map((peer) => (
                        <tr 
                          key={peer.id} 
                          data-testid={`row-peer-${peer.id}`}
                          className="border-b border-gray-800/50 hover:bg-gray-800/30"
                        >
                          <td className="p-3">
                            <span className="text-primary font-medium" data-testid={`text-nickname-${peer.id}`}>
                              {peer.nickname || 'Anonymous'}
                            </span>
                          </td>
                          <td className="p-3">
                            <code className="text-cyan-400 font-mono text-sm">{peer.roomId}</code>
                          </td>
                          <td className="p-3">
                            <div className="text-gray-300">
                              {peer.city && peer.country ? (
                                <div>
                                  <div className="font-medium">{peer.city}, {peer.country}</div>
                                  {peer.latitude && peer.longitude && (
                                    <div className="text-xs text-gray-500">
                                      {parseFloat(peer.latitude).toFixed(4)}, {parseFloat(peer.longitude).toFixed(4)}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-gray-500">Unknown</span>
                              )}
                            </div>
                          </td>
                          <td className="p-3 text-gray-300 font-mono text-sm">{peer.ipAddress}</td>
                          <td className="p-3 text-gray-300">
                            <div className="text-sm">
                              <div>{peer.os}</div>
                              <div className="text-xs text-gray-500">{peer.browser} • {peer.deviceType}</div>
                            </div>
                          </td>
                          <td className="p-3">
                            <span className="flex items-center text-green-400">
                              <Wifi className="h-4 w-4 mr-1" />
                              {new Date(peer.connectedAt).toLocaleTimeString()}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-900/90 border-cyan-500/20">
          <CardHeader>
            <CardTitle className="text-xl text-cyan-400 font-['Space_Grotesk']">
              Recent Disconnections
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {peers.filter(p => p.disconnectedAt).slice(0, 10).map((peer) => (
                <div 
                  key={peer.id} 
                  data-testid={`row-disconnected-${peer.id}`}
                  className="flex justify-between items-center p-3 bg-gray-800/30 rounded"
                >
                  <div>
                    <div className="mb-1">
                      <span className="text-primary font-medium">{peer.nickname || 'Anonymous'}</span>
                      <code className="text-cyan-400 font-mono text-sm ml-3">{peer.roomId}</code>
                    </div>
                    <span className="text-gray-500 text-sm">
                      {peer.city && peer.country ? `${peer.city}, ${peer.country}` : peer.ipAddress} • {peer.os} • {peer.browser}
                    </span>
                  </div>
                  <span className="flex items-center text-red-400 text-sm">
                    <WifiOff className="h-4 w-4 mr-1" />
                    {peer.disconnectedAt && new Date(peer.disconnectedAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
              {peers.filter(p => p.disconnectedAt).length === 0 && (
                <p className="text-gray-500 text-center py-4">No recent disconnections</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
