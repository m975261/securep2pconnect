import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const rooms = pgTable("rooms", {
  id: varchar("id").primaryKey(),
  password: text("password"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  peer1: text("peer1"),
  peer2: text("peer2"),
  isActive: boolean("is_active").notNull().default(true),
  turnUrls: text("turn_urls"),
  turnUsername: text("turn_username"),
  turnCredential: text("turn_credential"),
});

export const failedAttempts = pgTable("failed_attempts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  roomId: varchar("room_id").notNull(),
  ipAddress: text("ip_address").notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastAttempt: timestamp("last_attempt").notNull().defaultNow(),
  bannedUntil: timestamp("banned_until"),
});

export const adminUsers = pgTable("admin_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: varchar("username").notNull().unique(),
  password: text("password").notNull(),
  twoFactorSecret: text("two_factor_secret"),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  forcePasswordChange: boolean("force_password_change").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastLogin: timestamp("last_login"),
});

export const peerConnections = pgTable("peer_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  peerId: text("peer_id").notNull(),
  roomId: varchar("room_id").notNull(),
  nickname: text("nickname"),
  ipAddress: text("ip_address").notNull(),
  userAgent: text("user_agent"),
  deviceType: text("device_type"),
  os: text("os"),
  browser: text("browser"),
  country: text("country"),
  city: text("city"),
  latitude: text("latitude"),
  longitude: text("longitude"),
  connectedAt: timestamp("connected_at").notNull().defaultNow(),
  disconnectedAt: timestamp("disconnected_at"),
});

export const insertRoomSchema = createInsertSchema(rooms).omit({
  createdAt: true,
  isActive: true,
});

export const insertFailedAttemptSchema = createInsertSchema(failedAttempts).omit({
  id: true,
  lastAttempt: true,
});

export const insertAdminUserSchema = createInsertSchema(adminUsers).omit({
  id: true,
  createdAt: true,
  lastLogin: true,
});

export const insertPeerConnectionSchema = createInsertSchema(peerConnections).omit({
  id: true,
  connectedAt: true,
});

export type Room = typeof rooms.$inferSelect;
export type InsertRoom = z.infer<typeof insertRoomSchema>;
export type FailedAttempt = typeof failedAttempts.$inferSelect;
export type InsertFailedAttempt = z.infer<typeof insertFailedAttemptSchema>;
export type AdminUser = typeof adminUsers.$inferSelect;
export type InsertAdminUser = z.infer<typeof insertAdminUserSchema>;
export type PeerConnection = typeof peerConnections.$inferSelect;
export type InsertPeerConnection = z.infer<typeof insertPeerConnectionSchema>;
