import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { z } from "zod";
import { randomBytes } from "crypto";
import { registerAdminRoutes, initializeDefaultAdmin, parseUserAgent } from "./admin-routes";
import { encrypt, decrypt } from "./encryption";

const turnConfigSchema = z.object({
  urls: z.array(z.string()).min(1),
  username: z.string().min(1),
  credential: z.string().min(1),
});

const createRoomSchema = z.object({
  password: z.string().optional(),
  createdBy: z.string().optional(),
  turnConfig: turnConfigSchema,
});

const joinRoomSchema = z.object({
  password: z.string().optional(),
  nickname: z.string().optional(),
  createdBy: z.string().optional(),
});

const updateRoomPasswordSchema = z.object({
  password: z.string().min(1),
  createdBy: z.string(),
});

interface WebRTCMessage {
  type: "offer" | "answer" | "ice-candidate" | "join" | "peer-joined" | "peer-left" | "chat" | "file-metadata" | "file-chunk" | "file-eof";
  roomId?: string;
  data?: any;
  peerId?: string;
  nickname?: string;
}

interface RoomPeer {
  ws: WebSocket;
  peerId: string;
  roomId: string;
  nickname?: string;
}

const activePeers = new Map<string, RoomPeer>();
const roomPeers = new Map<string, Set<string>>();

function generateRoomId(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

function getClientIP(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

async function fetchLocationFromIP(ip: string): Promise<{
  country: string | null;
  city: string | null;
  latitude: string | null;
  longitude: string | null;
}> {
  if (ip === 'unknown' || ip.startsWith('127.') || ip === '::1') {
    return { country: null, city: null, latitude: null, longitude: null };
  }

  try {
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,city,lat,lon`);
    if (!response.ok) {
      return { country: null, city: null, latitude: null, longitude: null };
    }
    
    const data = await response.json();
    if (data.status === 'success') {
      return {
        country: data.country || null,
        city: data.city || null,
        latitude: data.lat ? data.lat.toString() : null,
        longitude: data.lon ? data.lon.toString() : null,
      };
    }
  } catch (error) {
    console.error('Failed to fetch location from IP:', error);
  }
  
  return { country: null, city: null, latitude: null, longitude: null };
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  await initializeDefaultAdmin();
  
  storage.cleanExpiredRooms().catch(console.error);

  setInterval(() => {
    storage.cleanExpiredRooms().catch(console.error);
  }, 60000);
  
  registerAdminRoutes(app);

  app.post("/api/rooms", async (req, res) => {
    try {
      const body = createRoomSchema.parse(req.body);
      const roomId = generateRoomId();
      
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      const room = await storage.createRoom({
        id: roomId,
        password: body.password || null,
        createdBy: body.createdBy || null,
        expiresAt,
        peer1: null,
        peer2: null,
        turnUrls: JSON.stringify(body.turnConfig.urls),
        turnUsername: encrypt(body.turnConfig.username),
        turnCredential: encrypt(body.turnConfig.credential),
      });

      res.json({ roomId: room.id });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "TURN server configuration is required to create a room" });
      }
      console.error("Error creating room:", error);
      res.status(500).json({ error: "Failed to create room" });
    }
  });

  app.patch("/api/rooms/:id/password", async (req, res) => {
    try {
      const { id } = req.params;
      const body = updateRoomPasswordSchema.parse(req.body);

      const room = await storage.getRoom(id);
      if (!room) {
        return res.status(404).json({ error: "Room not found" });
      }

      if (!room.createdBy || room.createdBy !== body.createdBy) {
        return res.status(403).json({ error: "Unauthorized: Only room creator can set password" });
      }

      await storage.updateRoomPassword(id, body.password);
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating room password:", error);
      res.status(500).json({ error: "Failed to update password" });
    }
  });

  app.delete("/api/rooms/:id/password", async (req, res) => {
    try {
      const { id } = req.params;
      const { createdBy } = req.body;

      const room = await storage.getRoom(id);
      if (!room) {
        return res.status(404).json({ error: "Room not found" });
      }

      if (!room.createdBy || room.createdBy !== createdBy) {
        return res.status(403).json({ error: "Unauthorized: Only room creator can remove password" });
      }

      await storage.updateRoomPassword(id, null);
      res.json({ success: true });
    } catch (error) {
      console.error("Error removing room password:", error);
      res.status(500).json({ error: "Failed to remove password" });
    }
  });

  app.post("/api/rooms/:id/join", async (req, res) => {
    try {
      const { id } = req.params;
      const body = joinRoomSchema.parse(req.body);
      const ipAddress = getClientIP(req);

      const isBanned = await storage.isBanned(id, ipAddress);
      if (isBanned) {
        return res.status(403).json({ 
          error: "Too many failed attempts. You are temporarily banned from this room." 
        });
      }

      const room = await storage.getRoom(id);
      if (!room) {
        return res.status(404).json({ error: "Room not found" });
      }

      const isCreator = room.createdBy && body.createdBy && room.createdBy === body.createdBy;

      if (room.password && room.password !== body.password && !isCreator) {
        const failedAttempt = await storage.recordFailedAttempt(id, ipAddress);
        
        if (failedAttempt.attempts >= 5) {
          await storage.banIP(id, ipAddress, 1);
          return res.status(403).json({ 
            error: "Too many failed attempts. You are banned for 1 hour." 
          });
        }

        return res.status(401).json({ 
          error: "Incorrect password",
          attemptsRemaining: 5 - failedAttempt.attempts 
        });
      }

      await storage.resetFailedAttempts(id, ipAddress);

      const turnConfig = await storage.getRoomTurnConfig(id);

      res.json({ 
        success: true, 
        hasPassword: !!room.password, 
        isCreator,
        turnConfig
      });
    } catch (error) {
      console.error("Error joining room:", error);
      res.status(500).json({ error: "Failed to join room" });
    }
  });

  app.get("/api/rooms/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const room = await storage.getRoom(id);
      
      if (!room) {
        return res.status(404).json({ error: "Room not found" });
      }

      const peerCount = roomPeers.get(id)?.size || 0;

      res.json({
        id: room.id,
        hasPassword: !!room.password,
        peerCount,
        isFull: peerCount >= 2,
      });
    } catch (error) {
      console.error("Error getting room:", error);
      res.status(500).json({ error: "Failed to get room" });
    }
  });

  wss.on("connection", (ws: WebSocket, req: Request) => {
    let currentPeer: RoomPeer | null = null;
    const ipAddress = getClientIP(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

    ws.on("message", async (data: Buffer) => {
      try {
        const message: WebRTCMessage = JSON.parse(data.toString());

        if (message.type === "join" && message.roomId && message.peerId) {
          const room = await storage.getRoom(message.roomId);
          if (!room) {
            ws.send(JSON.stringify({ type: "error", message: "Room not found" }));
            return;
          }

          const peers = roomPeers.get(message.roomId) || new Set();
          
          if (peers.size >= 2 && !peers.has(message.peerId)) {
            ws.send(JSON.stringify({ type: "error", message: "Room is full" }));
            return;
          }

          currentPeer = {
            ws,
            peerId: message.peerId,
            roomId: message.roomId,
            nickname: message.nickname,
          };

          activePeers.set(message.peerId, currentPeer);
          peers.add(message.peerId);
          roomPeers.set(message.roomId, peers);

          await storage.updateRoomPeer(message.roomId, message.peerId);
          
          const deviceInfo = parseUserAgent(userAgent);
          const locationData = await fetchLocationFromIP(ipAddress);
          await storage.trackPeerConnection({
            peerId: message.peerId,
            roomId: message.roomId,
            nickname: message.nickname || null,
            ipAddress,
            userAgent,
            deviceType: deviceInfo.deviceType,
            os: deviceInfo.os,
            browser: deviceInfo.browser,
            country: locationData.country,
            city: locationData.city,
            latitude: locationData.latitude,
            longitude: locationData.longitude,
            disconnectedAt: null,
          });

          peers.forEach((peerId) => {
            if (peerId !== message.peerId) {
              const peer = activePeers.get(peerId);
              if (peer && peer.ws.readyState === WebSocket.OPEN) {
                peer.ws.send(JSON.stringify({
                  type: "peer-joined",
                  peerId: message.peerId,
                  nickname: message.nickname,
                }));
              }
            }
          });

          const existingPeersWithNicknames = Array.from(peers)
            .filter(id => id !== message.peerId)
            .map(id => ({
              peerId: id,
              nickname: activePeers.get(id)?.nickname,
            }));

          ws.send(JSON.stringify({
            type: "joined",
            peerId: message.peerId,
            existingPeers: existingPeersWithNicknames,
          }));
        } else if (currentPeer && (message.type === "offer" || message.type === "answer" || message.type === "ice-candidate")) {
          const peers = roomPeers.get(currentPeer.roomId);
          if (peers) {
            peers.forEach((peerId) => {
              if (peerId !== currentPeer!.peerId) {
                const peer = activePeers.get(peerId);
                if (peer && peer.ws.readyState === WebSocket.OPEN) {
                  peer.ws.send(JSON.stringify({
                    type: message.type,
                    data: message.data,
                    from: currentPeer!.peerId,
                  }));
                }
              }
            });
          }
        } else if (currentPeer && message.type === "chat") {
          const peers = roomPeers.get(currentPeer.roomId);
          if (peers) {
            peers.forEach((peerId) => {
              if (peerId !== currentPeer!.peerId) {
                const peer = activePeers.get(peerId);
                if (peer && peer.ws.readyState === WebSocket.OPEN) {
                  peer.ws.send(JSON.stringify({
                    type: "chat",
                    data: message.data,
                    from: currentPeer!.peerId,
                  }));
                }
              }
            });
          }
        } else if (currentPeer && (message.type === "file-metadata" || message.type === "file-chunk" || message.type === "file-eof")) {
          const peers = roomPeers.get(currentPeer.roomId);
          if (peers) {
            peers.forEach((peerId) => {
              if (peerId !== currentPeer!.peerId) {
                const peer = activePeers.get(peerId);
                if (peer && peer.ws.readyState === WebSocket.OPEN) {
                  // For file-metadata, ensure we preserve/add sender identity
                  const enrichedData = message.type === "file-metadata" 
                    ? { ...message.data, from: currentPeer!.peerId, fromNickname: currentPeer!.nickname }
                    : message.data;
                  
                  peer.ws.send(JSON.stringify({
                    type: message.type,
                    data: enrichedData,
                    from: currentPeer!.peerId,
                  }));
                }
              }
            });
          }
        }
      } catch (error) {
        console.error("WebSocket message error:", error);
      }
    });

    ws.on("close", async () => {
      if (currentPeer) {
        const peers = roomPeers.get(currentPeer.roomId);
        if (peers) {
          peers.delete(currentPeer.peerId);
          
          peers.forEach((peerId) => {
            const peer = activePeers.get(peerId);
            if (peer && peer.ws.readyState === WebSocket.OPEN) {
              peer.ws.send(JSON.stringify({
                type: "peer-left",
                peerId: currentPeer!.peerId,
              }));
            }
          });

          if (peers.size === 0) {
            roomPeers.delete(currentPeer.roomId);
          }
        }
        activePeers.delete(currentPeer.peerId);
        
        await storage.disconnectPeer(currentPeer.peerId);
      }
    });
  });

  return httpServer;
}
