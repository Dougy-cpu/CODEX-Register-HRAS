import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const eventSettingsTable = pgTable("event_settings", {
  id: serial("id").primaryKey(),
  eventName: text("event_name").notNull().default("HR Analytics Summit"),
  eventDate: text("event_date").notNull().default("3 September 2026"),
  eventVenue: text("event_venue").notNull().default("155 Bishopsgate, London"),
  eventVenuePostcode: text("event_venue_postcode").notNull().default("EC2M 3TQ"),
  orgName: text("org_name").notNull().default("People Strategy Hub Ltd"),
  orgAddress: text("org_address").notNull().default("London, UK"),
  orgWebsite: text("org_website").notNull().default("https://www.hranalyticssummit.com"),
  logoDataUrl: text("logo_data_url"),
  fromName: text("from_name").notNull().default("HR Analytics Summit"),
  fromEmail: text("from_email").notNull().default("noreply@hranalyticssummit.com"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type EventSettings = typeof eventSettingsTable.$inferSelect;
