import { db } from "@workspace/db";
import { discountTiersTable, promoCodesTable, passConfigTable } from "@workspace/db";
import { eq, and, lte, gte, or, isNull, sql } from "drizzle-orm";

/**
 * Either the top-level `db` instance or a transactional handle obtained from
 * `db.transaction(async (tx) => ...)`. Both expose the same `select`/`update`
 * surface used by `incrementPromoUsage`, so callers can pass either.
 */
export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Atomically increment a promo code's `usedCount` after a successful booking
 * confirmation, refusing to exceed `maxUses` when set. For "complimentary"
 * codes the counter tracks tickets issued (so we add the booking's quantity);
 * for every other discount type the counter tracks bookings (so we add 1).
 *
 * Returns `true` if the counter was incremented, `false` if the increment was
 * rejected because it would exceed the cap. (`false` is also returned if the
 * code does not exist.)
 *
 * The cap check and the increment are performed in a single conditional
 * UPDATE so concurrent confirmations cannot oversubscribe a capped code.
 *
 * Pass an optional `conn` (a transaction handle) to make the increment part of
 * a larger atomic confirmation — the booking status update and this increment
 * then commit (or roll back) together, so a crash mid-confirmation can never
 * leave the booking marked paid while the promo counter is stale, or vice
 * versa.
 */
export async function incrementPromoUsage(
  code: string,
  quantity: number,
  conn: DbExecutor = db,
): Promise<boolean> {
  const normalised = code.toUpperCase();
  const [promo] = await conn
    .select({ discountType: promoCodesTable.discountType })
    .from(promoCodesTable)
    .where(eq(promoCodesTable.code, normalised));
  if (!promo) return false;
  const inc = promo.discountType === "complimentary" ? Math.max(1, quantity) : 1;
  const result = await conn
    .update(promoCodesTable)
    .set({ usedCount: sql`${promoCodesTable.usedCount} + ${inc}` })
    .where(
      and(
        eq(promoCodesTable.code, normalised),
        or(
          isNull(promoCodesTable.maxUses),
          sql`${promoCodesTable.usedCount} + ${inc} <= ${promoCodesTable.maxUses}`,
        ),
      ),
    );
  return (result.rowCount ?? 0) > 0;
}

export const PASS_PRICES: Record<string, { price: number; originalPrice: number; seats: number }> =
  {
    single: { price: 199, originalPrice: 429, seats: 1 },
    team: { price: 499, originalPrice: 1200, seats: 3 },
    business: { price: 599, originalPrice: 999, seats: 1 },
  };

const PASS_PRICE_DEFAULTS = PASS_PRICES;

async function getPassPrices(): Promise<
  Record<string, { price: number; originalPrice: number; seats: number }>
> {
  const configs = await db.select().from(passConfigTable);
  const result = { ...PASS_PRICE_DEFAULTS };
  for (const config of configs) {
    if (result[config.passType]) {
      result[config.passType] = {
        ...result[config.passType],
        price: parseFloat(config.currentPrice.toString()),
        originalPrice: parseFloat(config.originalPrice.toString()),
      };
    }
  }
  return result;
}

export const VAT_RATE = 0.2;

export interface PricingResult {
  passType: string;
  quantity: number;
  pricePerHead: number;
  baseSubtotal: number;
  groupDiscountPercent: number;
  groupDiscountAmount: number;
  promoDiscountAmount: number;
  subtotalAfterDiscounts: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  originalPrice: number;
  savedAmount: number;
  promoDiscountType?: string | null;
  promoRemainingSeats?: number | null;
}

export async function calculatePricing(
  passType: string,
  quantity: number,
  promoCode?: string | null,
): Promise<PricingResult> {
  const PASS_PRICES = await getPassPrices();
  const passInfo = PASS_PRICES[passType];
  if (!passInfo) throw new Error(`Unknown pass type: ${passType}`);

  const pricePerHead = passInfo.price;

  // Team pass is a fixed-price bundle: 1 bundle = £499 for 3 seats.
  // Other passes are per-unit: quantity drives the base price.
  const billingUnits = passInfo.seats > 1 ? Math.ceil(quantity / passInfo.seats) : quantity;

  const baseSubtotal = pricePerHead * billingUnits;
  const originalPrice = passInfo.originalPrice * billingUnits;

  const tiers = await db
    .select()
    .from(discountTiersTable)
    .where(eq(discountTiersTable.passType, passType as "single" | "team" | "business"))
    .orderBy(discountTiersTable.minQuantity);

  let groupDiscountPercent = 0;
  for (const tier of tiers) {
    if (quantity >= tier.minQuantity) {
      groupDiscountPercent = parseFloat(tier.discountPercent.toString());
    }
  }

  const groupDiscountAmount = parseFloat(((baseSubtotal * groupDiscountPercent) / 100).toFixed(2));

  let promoDiscountAmount = 0;
  let promoDiscountType: string | null = null;
  let promoRemainingSeats: number | null = null;
  if (promoCode) {
    const now = new Date();
    const [promo] = await db
      .select()
      .from(promoCodesTable)
      .where(
        and(
          eq(promoCodesTable.code, promoCode.toUpperCase()),
          eq(promoCodesTable.isActive, true),
          or(isNull(promoCodesTable.validFrom), lte(promoCodesTable.validFrom, now)),
          or(isNull(promoCodesTable.validUntil), gte(promoCodesTable.validUntil, now)),
        ),
      );

    if (promo) {
      promoDiscountType = promo.discountType;
      const afterGroupDiscount = baseSubtotal - groupDiscountAmount;
      if (promo.discountType === "percentage") {
        promoDiscountAmount = parseFloat(
          ((afterGroupDiscount * parseFloat(promo.discountValue.toString())) / 100).toFixed(2),
        );
        if (promo.maxDiscountAmount !== null) {
          const cap = parseFloat(promo.maxDiscountAmount.toString());
          if (promoDiscountAmount > cap) promoDiscountAmount = cap;
        }
      } else if (promo.discountType === "per_ticket") {
        promoDiscountAmount = Math.min(
          parseFloat((parseFloat(promo.discountValue.toString()) * quantity).toFixed(2)),
          afterGroupDiscount,
        );
      } else if (promo.discountType === "complimentary") {
        if (promo.maxUses !== null) {
          promoRemainingSeats = Math.max(0, promo.maxUses - promo.usedCount);
        }
        // Comp = 100% off, but only if every requested ticket is covered by
        // the remaining cap. If the request exceeds remaining seats, the
        // discount does not apply — the caller (UI) will surface a prompt
        // asking the user to reduce the quantity or remove the code.
        if (promoRemainingSeats === null || promoRemainingSeats >= quantity) {
          promoDiscountAmount = afterGroupDiscount;
        }
      } else {
        promoDiscountAmount = Math.min(
          parseFloat(promo.discountValue.toString()),
          afterGroupDiscount,
        );
      }
    }
  }

  const subtotalAfterDiscounts = parseFloat(
    (baseSubtotal - groupDiscountAmount - promoDiscountAmount).toFixed(2),
  );
  const vatAmount = parseFloat((subtotalAfterDiscounts * VAT_RATE).toFixed(2));
  const total = parseFloat((subtotalAfterDiscounts + vatAmount).toFixed(2));
  const savedAmount = parseFloat(
    (originalPrice - baseSubtotal + groupDiscountAmount + promoDiscountAmount).toFixed(2),
  );

  return {
    passType,
    quantity,
    pricePerHead,
    baseSubtotal,
    groupDiscountPercent,
    groupDiscountAmount,
    promoDiscountAmount,
    subtotalAfterDiscounts,
    vatRate: VAT_RATE,
    vatAmount,
    total,
    originalPrice,
    savedAmount,
    promoDiscountType,
    promoRemainingSeats,
  };
}
