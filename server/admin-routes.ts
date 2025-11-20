import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { z } from "zod";
import bcrypt from "bcrypt";
import { TOTP } from "otpauth";
import QRCode from "qrcode";

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.adminLoggedIn || !req.session.adminUsername) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  
  const admin = await storage.getAdminByUsername(req.session.adminUsername);
  if (admin && admin.twoFactorEnabled && !req.session.admin2FAVerified) {
    return res.status(401).json({ error: "2FA verification required" });
  }
  
  next();
}

const adminLoginSchema = z.object({
  username: z.string(),
  password: z.string(),
  totpCode: z.string().optional(),
});

const adminPasswordChangeSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8),
});

const admin2FAEnableSchema = z.object({
  password: z.string(),
});

const admin2FAVerifySchema = z.object({
  totpCode: z.string(),
});

function getClientIP(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function parseUserAgent(userAgent: string): { deviceType: string; os: string; browser: string } {
  const ua = userAgent.toLowerCase();
  
  let deviceType = 'desktop';
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    deviceType = 'tablet';
  } else if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(userAgent)) {
    deviceType = 'mobile';
  }
  
  let os = 'unknown';
  if (ua.indexOf('win') > -1) os = 'Windows';
  else if (ua.indexOf('mac') > -1) os = 'MacOS';
  else if (ua.indexOf('linux') > -1) os = 'Linux';
  else if (ua.indexOf('android') > -1) os = 'Android';
  else if (ua.indexOf('iphone') > -1 || ua.indexOf('ipad') > -1) os = 'iOS';
  
  let browser = 'unknown';
  if (ua.indexOf('chrome') > -1 && ua.indexOf('edg') === -1) browser = 'Chrome';
  else if (ua.indexOf('safari') > -1 && ua.indexOf('chrome') === -1) browser = 'Safari';
  else if (ua.indexOf('firefox') > -1) browser = 'Firefox';
  else if (ua.indexOf('edg') > -1) browser = 'Edge';
  else if (ua.indexOf('opera') > -1 || ua.indexOf('opr') > -1) browser = 'Opera';
  
  return { deviceType, os, browser };
}

export async function initializeDefaultAdmin() {
  const existingAdmin = await storage.getAdminByUsername('admin');
  
  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash('admin@5261', 10);
    await storage.createAdminUser({
      username: 'admin',
      password: hashedPassword,
      forcePasswordChange: true,
      twoFactorEnabled: false,
      twoFactorSecret: null,
    });
    console.log('Default admin user created (username: admin, password: admin@5261)');
  }
}

export function registerAdminRoutes(app: Express) {
  app.post("/api/admin/login", async (req, res) => {
    try {
      const body = adminLoginSchema.parse(req.body);
      const admin = await storage.getAdminByUsername(body.username);
      
      if (!admin) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      
      const passwordValid = await bcrypt.compare(body.password, admin.password);
      if (!passwordValid) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      
      if (admin.twoFactorEnabled) {
        if (!body.totpCode) {
          return res.json({ 
            requires2FA: true,
            forcePasswordChange: admin.forcePasswordChange 
          });
        }
        
        const totp = new TOTP({
          secret: admin.twoFactorSecret!,
        });
        
        const valid = totp.validate({ token: body.totpCode, window: 1 });
        if (valid === null) {
          return res.status(401).json({ error: "Invalid 2FA code" });
        }
      }
      
      req.session.adminUsername = body.username;
      req.session.adminLoggedIn = true;
      req.session.admin2FAVerified = true;
      
      await storage.updateAdminLastLogin(body.username);
      
      res.json({ 
        success: true,
        forcePasswordChange: admin.forcePasswordChange,
        username: admin.username 
      });
    } catch (error) {
      console.error("Admin login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.post("/api/admin/change-password", requireAuth, async (req, res) => {
    try {
      const body = adminPasswordChangeSchema.parse(req.body);
      const username = req.session.adminUsername!;
      
      const admin = await storage.getAdminByUsername(username);
      if (!admin) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const passwordValid = await bcrypt.compare(body.currentPassword, admin.password);
      if (!passwordValid) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }
      
      const hashedPassword = await bcrypt.hash(body.newPassword, 10);
      await storage.updateAdminPassword(username, hashedPassword);
      
      res.json({ success: true });
    } catch (error) {
      console.error("Password change error:", error);
      res.status(500).json({ error: "Failed to change password" });
    }
  });

  app.post("/api/admin/2fa/enable", requireAuth, async (req, res) => {
    try {
      const body = admin2FAEnableSchema.parse(req.body);
      const username = req.session.adminUsername!;
      
      const admin = await storage.getAdminByUsername(username);
      if (!admin) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const passwordValid = await bcrypt.compare(body.password, admin.password);
      if (!passwordValid) {
        return res.status(401).json({ error: "Invalid password" });
      }
      
      const totp = new TOTP({
        issuer: 'SECURE.LINK',
        label: username,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
      });
      
      const qrCodeUrl = await QRCode.toDataURL(totp.toString());
      
      res.json({ 
        secret: totp.secret.base32,
        qrCode: qrCodeUrl 
      });
    } catch (error) {
      console.error("2FA enable error:", error);
      res.status(500).json({ error: "Failed to enable 2FA" });
    }
  });

  app.post("/api/admin/2fa/verify", requireAuth, async (req, res) => {
    try {
      const body = admin2FAVerifySchema.parse(req.body);
      const username = req.session.adminUsername!;
      
      const admin = await storage.getAdminByUsername(username);
      if (!admin) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const secret = req.body.secret;
      const totp = new TOTP({
        secret: secret,
      });
      
      const valid = totp.validate({ token: body.totpCode, window: 1 });
      if (valid === null) {
        return res.status(401).json({ error: "Invalid code" });
      }
      
      await storage.updateAdmin2FA(username, secret, true);
      req.session.admin2FAVerified = true;
      
      res.json({ success: true });
    } catch (error) {
      console.error("2FA verify error:", error);
      res.status(500).json({ error: "Failed to verify 2FA" });
    }
  });

  app.post("/api/admin/2fa/disable", requireAuth, async (req, res) => {
    try {
      const username = req.session.adminUsername!;
      await storage.updateAdmin2FA(username, null, false);
      req.session.admin2FAVerified = true;
      res.json({ success: true });
    } catch (error) {
      console.error("2FA disable error:", error);
      res.status(500).json({ error: "Failed to disable 2FA" });
    }
  });

  app.get("/api/admin/status", requireAuth, async (req, res) => {
    const admin = await storage.getAdminByUsername(req.session.adminUsername!);
    res.json({ 
      authenticated: true,
      username: req.session.adminUsername,
      twoFactorVerified: req.session.admin2FAVerified || false,
      twoFactorEnabled: admin?.twoFactorEnabled || false
    });
  });

  app.post("/api/admin/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  app.get("/api/admin/peers", requireAuth, async (req, res) => {
    try {
      const peers = await storage.getActivePeerConnections();
      res.json({ peers });
    } catch (error) {
      console.error("Error fetching peers:", error);
      res.status(500).json({ error: "Failed to fetch peers" });
    }
  });
}

export { parseUserAgent };
