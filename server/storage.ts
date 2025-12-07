import { eq, and, lt, isNull } from "drizzle-orm";
import {
  type Room,
  type InsertRoom,
  type FailedAttempt,
  type InsertFailedAttempt,
  type AdminUser,
  type InsertAdminUser,
  type PeerConnection,
  type InsertPeerConnection,
  rooms,
  failedAttempts,
  adminUsers,
  peerConnections,
} from "@shared/schema";
import { decrypt } from "./encryption";

// Determine which database driver to use based on DATABASE_URL
const isNeonDatabase = process.env.DATABASE_URL?.includes('neon.tech') || 
                       process.env.DATABASE_URL?.includes('neon.') ||
                       (process.env.DATABASE_URL?.startsWith('postgresql://') && process.env.DATABASE_URL?.includes('@ep-'));

let db: any = null;
let dbInitialized = false;

async function getDb() {
  if (dbInitialized) return db;
  
  if (isNeonDatabase) {
    // Use Neon serverless driver for Neon cloud databases
    const { neon } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-http");
    const sql = neon(process.env.DATABASE_URL!);
    db = drizzle(sql);
  } else {
    // Use standard pg driver for local PostgreSQL
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL!,
    });
    db = drizzle(pool);
  }
  
  dbInitialized = true;
  return db;
}

export interface TurnConfig {
  urls: string[];
  username: string;
  credential: string;
  stunUrls?: string[];
}

export interface IStorage {
  createRoom(room: InsertRoom): Promise<Room>;
  getRoom(id: string): Promise<Room | undefined>;
  getRoomTurnConfig(id: string): Promise<TurnConfig | null>;
  updateRoomPeer(roomId: string, peerId: string): Promise<void>;
  updateRoomPassword(roomId: string, password: string | null): Promise<void>;
  deleteRoom(id: string): Promise<void>;
  
  recordFailedAttempt(roomId: string, ipAddress: string): Promise<FailedAttempt>;
  getFailedAttempts(roomId: string, ipAddress: string): Promise<FailedAttempt | undefined>;
  resetFailedAttempts(roomId: string, ipAddress: string): Promise<void>;
  isBanned(roomId: string, ipAddress: string): Promise<boolean>;
  banIP(roomId: string, ipAddress: string, hours: number): Promise<void>;
  cleanExpiredRooms(): Promise<void>;
  
  createAdminUser(admin: InsertAdminUser): Promise<AdminUser>;
  getAdminByUsername(username: string): Promise<AdminUser | undefined>;
  updateAdminPassword(username: string, newPassword: string): Promise<void>;
  updateAdmin2FA(username: string, secret: string | null, enabled: boolean): Promise<void>;
  updateAdminLastLogin(username: string): Promise<void>;
  
  trackPeerConnection(peer: InsertPeerConnection): Promise<PeerConnection>;
  disconnectPeer(peerId: string): Promise<void>;
  getActivePeerConnections(): Promise<PeerConnection[]>;
  getPeersByRoom(roomId: string): Promise<PeerConnection[]>;
}

export class DbStorage implements IStorage {
  async createRoom(insertRoom: InsertRoom): Promise<Room> {
    const db = await getDb();
    const [room] = await db.insert(rooms).values(insertRoom).returning();
    return room;
  }

  async getRoom(id: string): Promise<Room | undefined> {
    const db = await getDb();
    const [room] = await db
      .select()
      .from(rooms)
      .where(and(eq(rooms.id, id), eq(rooms.isActive, true)));
    return room;
  }

  async getRoomTurnConfig(id: string): Promise<TurnConfig | null> {
    const room = await this.getRoom(id);
    if (!room || !room.turnUrls || !room.turnUsername || !room.turnCredential) {
      return null;
    }
    return {
      urls: JSON.parse(room.turnUrls),
      username: decrypt(room.turnUsername),
      credential: decrypt(room.turnCredential),
      stunUrls: room.stunUrls ? JSON.parse(room.stunUrls) : undefined,
    };
  }

  async updateRoomPeer(roomId: string, peerId: string): Promise<void> {
    const db = await getDb();
    const room = await this.getRoom(roomId);
    if (!room) throw new Error("Room not found");

    if (!room.peer1) {
      await db.update(rooms).set({ peer1: peerId }).where(eq(rooms.id, roomId));
    } else if (!room.peer2 && room.peer1 !== peerId) {
      await db.update(rooms).set({ peer2: peerId }).where(eq(rooms.id, roomId));
    }
  }

  async updateRoomPassword(roomId: string, password: string | null): Promise<void> {
    const db = await getDb();
    await db.update(rooms).set({ password }).where(eq(rooms.id, roomId));
  }

  async deleteRoom(id: string): Promise<void> {
    const db = await getDb();
    await db.update(rooms).set({ isActive: false }).where(eq(rooms.id, id));
  }

  async recordFailedAttempt(roomId: string, ipAddress: string): Promise<FailedAttempt> {
    const db = await getDb();
    const existing = await this.getFailedAttempts(roomId, ipAddress);

    if (existing) {
      const [updated] = await db
        .update(failedAttempts)
        .set({
          attempts: existing.attempts + 1,
          lastAttempt: new Date(),
        })
        .where(eq(failedAttempts.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(failedAttempts)
        .values({ roomId, ipAddress, attempts: 1 })
        .returning();
      return created;
    }
  }

  async getFailedAttempts(roomId: string, ipAddress: string): Promise<FailedAttempt | undefined> {
    const db = await getDb();
    const [attempt] = await db
      .select()
      .from(failedAttempts)
      .where(and(eq(failedAttempts.roomId, roomId), eq(failedAttempts.ipAddress, ipAddress)));
    return attempt;
  }

  async resetFailedAttempts(roomId: string, ipAddress: string): Promise<void> {
    const db = await getDb();
    await db
      .delete(failedAttempts)
      .where(and(eq(failedAttempts.roomId, roomId), eq(failedAttempts.ipAddress, ipAddress)));
  }

  async isBanned(roomId: string, ipAddress: string): Promise<boolean> {
    const attempt = await this.getFailedAttempts(roomId, ipAddress);
    if (!attempt || !attempt.bannedUntil) return false;
    
    const now = new Date();
    return attempt.bannedUntil > now;
  }

  async banIP(roomId: string, ipAddress: string, hours: number): Promise<void> {
    const db = await getDb();
    const bannedUntil = new Date();
    bannedUntil.setHours(bannedUntil.getHours() + hours);

    const existing = await this.getFailedAttempts(roomId, ipAddress);
    if (existing) {
      await db
        .update(failedAttempts)
        .set({ bannedUntil })
        .where(eq(failedAttempts.id, existing.id));
    }
  }

  async cleanExpiredRooms(): Promise<void> {
    const db = await getDb();
    await db
      .update(rooms)
      .set({ isActive: false })
      .where(and(eq(rooms.isActive, true), lt(rooms.expiresAt, new Date())));
  }

  async createAdminUser(insertAdmin: InsertAdminUser): Promise<AdminUser> {
    const db = await getDb();
    const [admin] = await db.insert(adminUsers).values(insertAdmin).returning();
    return admin;
  }

  async getAdminByUsername(username: string): Promise<AdminUser | undefined> {
    const db = await getDb();
    const [admin] = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.username, username));
    return admin;
  }

  async updateAdminPassword(username: string, newPassword: string): Promise<void> {
    const db = await getDb();
    await db
      .update(adminUsers)
      .set({ password: newPassword, forcePasswordChange: false })
      .where(eq(adminUsers.username, username));
  }

  async updateAdmin2FA(username: string, secret: string | null, enabled: boolean): Promise<void> {
    const db = await getDb();
    await db
      .update(adminUsers)
      .set({ twoFactorSecret: secret, twoFactorEnabled: enabled })
      .where(eq(adminUsers.username, username));
  }

  async updateAdminLastLogin(username: string): Promise<void> {
    const db = await getDb();
    await db
      .update(adminUsers)
      .set({ lastLogin: new Date() })
      .where(eq(adminUsers.username, username));
  }

  async trackPeerConnection(insertPeer: InsertPeerConnection): Promise<PeerConnection> {
    const db = await getDb();
    const [peer] = await db.insert(peerConnections).values(insertPeer).returning();
    return peer;
  }

  async disconnectPeer(peerId: string): Promise<void> {
    const db = await getDb();
    await db
      .update(peerConnections)
      .set({ disconnectedAt: new Date() })
      .where(and(eq(peerConnections.peerId, peerId), isNull(peerConnections.disconnectedAt)));
  }

  async getActivePeerConnections(): Promise<PeerConnection[]> {
    const db = await getDb();
    return await db
      .select()
      .from(peerConnections)
      .where(isNull(peerConnections.disconnectedAt));
  }

  async getPeersByRoom(roomId: string): Promise<PeerConnection[]> {
    const db = await getDb();
    return await db
      .select()
      .from(peerConnections)
      .where(eq(peerConnections.roomId, roomId));
  }
}

export const storage = new DbStorage();
