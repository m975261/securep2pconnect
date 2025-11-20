import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const rooms = pgTable("rooms", {
  id: varchar("id").primaryKey(),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  peer1: text("peer1"),
  peer2: text("peer2"),
  isActive: boolean("is_active").notNull().default(true),
});

export const failedAttempts = pgTable("failed_attempts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  roomId: varchar("room_id").notNull(),
  ipAddress: text("ip_address").notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastAttempt: timestamp("last_attempt").notNull().defaultNow(),
  bannedUntil: timestamp("banned_until"),
});

export const insertRoomSchema = createInsertSchema(rooms).omit({
  createdAt: true,
  isActive: true,
});

export const insertFailedAttemptSchema = createInsertSchema(failedAttempts).omit({
  id: true,
  lastAttempt: true,
});

export type Room = typeof rooms.$inferSelect;
export type InsertRoom = z.infer<typeof insertRoomSchema>;
export type FailedAttempt = typeof failedAttempts.$inferSelect;
export type InsertFailedAttempt = z.infer<typeof insertFailedAttemptSchema>;
