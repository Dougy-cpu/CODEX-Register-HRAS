import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const notificationEmailsTable = pgTable("notification_emails", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationEmail = typeof notificationEmailsTable.$inferSelect;
export type InsertNotificationEmail = typeof notificationEmailsTable.$inferInsert;
