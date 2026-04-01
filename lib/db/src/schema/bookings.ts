import { pgTable, text, serial, timestamp, integer, numeric, pgEnum, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const bookingStatusEnum = pgEnum("booking_status", [
  "partial",
  "pending_payment",
  "paid",
  "invoiced",
  "cancelled",
]);

export const passTypeEnum = pgEnum("pass_type", ["single", "team", "business"]);

export const attendeeTypeEnum = pgEnum("attendee_type", [
  "hr_professional",
  "consultant_vendor",
]);

export const paymentMethodEnum = pgEnum("payment_method", ["card", "invoice"]);

export const bookingsTable = pgTable("bookings", {
  id: serial("id").primaryKey(),
  sessionToken: text("session_token").notNull().unique(),
  status: bookingStatusEnum("status").notNull().default("partial"),
  passType: passTypeEnum("pass_type").notNull(),
  attendeeType: attendeeTypeEnum("attendee_type").notNull(),
  quantity: integer("quantity").notNull().default(1),
  promoCode: text("promo_code"),
  promoDiscountAmount: numeric("promo_discount_amount", { precision: 10, scale: 2 }),
  groupDiscountAmount: numeric("group_discount_amount", { precision: 10, scale: 2 }),
  subtotalAmount: numeric("subtotal_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  vatAmount: numeric("vat_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  paymentMethod: paymentMethodEnum("payment_method"),
  stripeSessionId: text("stripe_session_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  freeagentInvoiceId: text("freeagent_invoice_id"),
  freeagentInvoiceUrl: text("freeagent_invoice_url"),
  freeagentPaymentUrl: text("freeagent_payment_url"),
  stripeInvoiceId: text("stripe_invoice_id"),
  stripeInvoicePdfUrl: text("stripe_invoice_pdf_url"),
  stripeInvoicePaymentUrl: text("stripe_invoice_payment_url"),
  orderReference: text("order_reference"),
  currentStep: integer("current_step").notNull().default(1),
  billingName: text("billing_name"),
  billingCompany: text("billing_company"),
  billingEmail: text("billing_email"),
  billingAddress: text("billing_address"),
  billingAddressLine1: text("billing_address_line1"),
  billingAddressLine2: text("billing_address_line2"),
  billingTown: text("billing_town"),
  billingRegion: text("billing_region"),
  billingPostcode: text("billing_postcode"),
  billingCountry: text("billing_country"),
  partialNotificationSent: boolean("partial_notification_sent").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBookingSchema = createInsertSchema(bookingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookingsTable.$inferSelect;
