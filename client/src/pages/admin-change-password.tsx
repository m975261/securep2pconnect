import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export default function AdminChangePassword() {
  const [, setLocation] = useLocation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch("/api/admin/status");
        if (!response.ok) {
          setLocation("/admin/login");
        }
      } catch {
        setLocation("/admin/login");
      }
    };
    checkAuth();
  }, [setLocation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Failed to change password");
        setLoading(false);
        return;
      }

      toast.success("Password changed successfully");
      setLocation("/admin/dashboard");
    } catch (error) {
      toast.error("Failed to change password");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-gray-900/90 border-cyan-500/20">
        <CardHeader>
          <CardTitle className="text-2xl text-cyan-400 font-['Space_Grotesk']">
            Change Password
          </CardTitle>
          <CardDescription className="text-gray-400">
            You must change your password before continuing
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="current" className="text-gray-300">Current Password</Label>
              <Input
                id="current"
                data-testid="input-current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="bg-gray-800/50 border-gray-700 text-white"
                required
              />
            </div>

            <div>
              <Label htmlFor="new" className="text-gray-300">New Password</Label>
              <Input
                id="new"
                data-testid="input-new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="bg-gray-800/50 border-gray-700 text-white"
                minLength={8}
                required
              />
            </div>

            <div>
              <Label htmlFor="confirm" className="text-gray-300">Confirm Password</Label>
              <Input
                id="confirm"
                data-testid="input-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="bg-gray-800/50 border-gray-700 text-white"
                minLength={8}
                required
              />
            </div>

            <Button
              type="submit"
              data-testid="button-change-password"
              disabled={loading}
              className="w-full bg-cyan-500 hover:bg-cyan-600 text-gray-900 font-['Space_Grotesk']"
            >
              {loading ? "Changing..." : "Change Password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
