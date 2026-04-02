import { pgTable, serial, timestamp, integer, jsonb, varchar } from "drizzle-orm/pg-core";
import { bookingsTable } from "./bookings";
import { attendeesTable } from "./attendees";

export const activityTypeEnum = [
  "attendee_change",
  "tbc_filled",
] as const;

export type ActivityType = typeof activityTypeEnum[number];

export const activityLogTable = pgTable("activity_log", {
  id: serial("id").primaryKey(),
  type: varchar("type", { length: 50 }).notNull(),
  bookingId: integer("booking_id").references(() => bookingsTable.id),
  attendeeId: integer("attendee_id").references(() => attendeesTable.id),
  data: jsonb("data"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ActivityLog = typeof activityLogTable.$inferSelect;
export type InsertActivityLog = typeof activityLogTable.$inferInsert;
