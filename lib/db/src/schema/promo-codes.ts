import { pgTable, text, serial, timestamp, integer, boolean, numeric, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";

export const discountTypeEnum = pgEnum("discount_type", ["percentage", "fixed", "per_ticket", "complimentary"]);

export const promoCodesTable = pgTable("promo_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  discountType: discountTypeEnum("discount_type").notNull(),
  discountValue: numeric("discount_value", { precision: 10, scale: 2 }).notNull(),
  maxUses: integer("max_uses"),
  usedCount: integer("used_count").notNull().default(0),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  applicablePassTypes: text("applicable_pass_types").array().notNull().default(sql`ARRAY['single','business']`),
  description: text("description"),
  oncePerCustomer: boolean("once_per_customer").notNull().default(false),
  minQuantity: integer("min_quantity"),
  maxDiscountAmount: numeric("max_discount_amount", { precision: 10, scale: 2 }),
  internalNote: text("internal_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPromoCodeSchema = createInsertSchema(promoCodesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  usedCount: true,
});
export type InsertPromoCode = z.infer<typeof insertPromoCodeSchema>;
export type PromoCode = typeof promoCodesTable.$inferSelect;
