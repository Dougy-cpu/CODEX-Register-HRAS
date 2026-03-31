import { pgTable, text, serial, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { bookingsTable } from "./bookings";

export const emailLogTypeEnum = pgEnum("email_log_type", [
  "confirmation",
  "receipt",
  "welcome",
  "invoice",
  "test",
]);

export const emailStatusEnum = pgEnum("email_status", ["sent", "failed", "pending"]);

export const emailLogsTable = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").references(() => bookingsTable.id, { onDelete: "set null" }),
  recipient: text("recipient").notNull(),
  type: emailLogTypeEnum("type").notNull(),
  status: emailStatusEnum("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEmailLogSchema = createInsertSchema(emailLogsTable).omit({
  id: true,
  sentAt: true,
});
export type InsertEmailLog = z.infer<typeof insertEmailLogSchema>;
export type EmailLog = typeof emailLogsTable.$inferSelect;
