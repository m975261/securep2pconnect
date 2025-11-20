import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { z } from "zod";
import { randomBytes } from "crypto";

const createRoomSchema = z.object({
  password: z.string().optional(),
});

const joinRoomSchema = z.object({
  password: z.string().optional(),
});

interface WebRTCMessage {
  type: "offer" | "answer" | "ice-candidate" | "join" | "peer-joined" | "peer-left";
  roomId?: string;
  data?: any;
  peerId?: string;
}

interface RoomPeer {
  ws: WebSocket;
  peerId: string;
  roomId: string;
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

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  await storage.cleanExpiredRooms();

  setInterval(() => {
    storage.cleanExpiredRooms();
  }, 60000);

  app.post("/api/rooms", async (req, res) => {
    try {
      const body = createRoomSchema.parse(req.body);
      const roomId = generateRoomId();
      
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      const room = await storage.createRoom({
        id: roomId,
        password: body.password || null,
        expiresAt,
        peer1: null,
        peer2: null,
      });

      res.json({ roomId: room.id });
    } catch (error) {
      console.error("Error creating room:", error);
      res.status(500).json({ error: "Failed to create room" });
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

      if (room.password && room.password !== body.password) {
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

      res.json({ success: true, hasPassword: !!room.password });
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

  wss.on("connection", (ws: WebSocket) => {
    let currentPeer: RoomPeer | null = null;

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
          };

          activePeers.set(message.peerId, currentPeer);
          peers.add(message.peerId);
          roomPeers.set(message.roomId, peers);

          await storage.updateRoomPeer(message.roomId, message.peerId);

          peers.forEach((peerId) => {
            if (peerId !== message.peerId) {
              const peer = activePeers.get(peerId);
              if (peer && peer.ws.readyState === WebSocket.OPEN) {
                peer.ws.send(JSON.stringify({
                  type: "peer-joined",
                  peerId: message.peerId,
                }));
              }
            }
          });

          ws.send(JSON.stringify({
            type: "joined",
            peerId: message.peerId,
            existingPeers: Array.from(peers).filter(id => id !== message.peerId),
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
        }
      } catch (error) {
        console.error("WebSocket message error:", error);
      }
    });

    ws.on("close", () => {
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
      }
    });
  });

  return httpServer;
}
