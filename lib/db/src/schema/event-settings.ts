import { pgTable, text, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";

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
  freeagentRefreshToken: text("freeagent_refresh_token"),
  freeagentAccessToken: text("freeagent_access_token"),
  freeagentTokenExpiresAt: timestamp("freeagent_token_expires_at", { withTimezone: true }),
  attendeeChangesLocked: boolean("attendee_changes_locked").notNull().default(false),
  attendeeChangesLockedMessage: text("attendee_changes_locked_message"),
  // Booking reference format
  refPrefix: text("ref_prefix").notNull().default("HRAS26"),
  refOffset: integer("ref_offset").notNull().default(6541),
  // Notification email subject templates (support {{variables}})
  notifyCompleteSubject: text("notify_complete_subject"),
  notifyIncompleteSubject: text("notify_incomplete_subject"),
  notifyAttendeeSubject: text("notify_attendee_subject"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type EventSettings = typeof eventSettingsTable.$inferSelect;
