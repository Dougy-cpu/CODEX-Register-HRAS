import { db } from "@workspace/db";
import { discountTiersTable, promoCodesTable } from "@workspace/db";
import { eq, and, lte, gte, or, isNull } from "drizzle-orm";

export const PASS_PRICES: Record<string, { price: number; originalPrice: number; seats: number }> = {
  single: { price: 199, originalPrice: 429, seats: 1 },
  team: { price: 499, originalPrice: 1200, seats: 3 },
  business: { price: 599, originalPrice: 999, seats: 1 },
};

export const VAT_RATE = 0.20;

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
}

export async function calculatePricing(
  passType: string,
  quantity: number,
  promoCode?: string | null
): Promise<PricingResult> {
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

  const groupDiscountAmount = parseFloat(
    ((baseSubtotal * groupDiscountPercent) / 100).toFixed(2)
  );

  let promoDiscountAmount = 0;
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
          or(isNull(promoCodesTable.validUntil), gte(promoCodesTable.validUntil, now))
        )
      );

    if (promo) {
      const afterGroupDiscount = baseSubtotal - groupDiscountAmount;
      if (promo.discountType === "percentage") {
        promoDiscountAmount = parseFloat(
          ((afterGroupDiscount * parseFloat(promo.discountValue.toString())) / 100).toFixed(2)
        );
      } else {
        promoDiscountAmount = Math.min(
          parseFloat(promo.discountValue.toString()),
          afterGroupDiscount
        );
      }
    }
  }

  const subtotalAfterDiscounts = parseFloat(
    (baseSubtotal - groupDiscountAmount - promoDiscountAmount).toFixed(2)
  );
  const vatAmount = parseFloat((subtotalAfterDiscounts * VAT_RATE).toFixed(2));
  const total = parseFloat((subtotalAfterDiscounts + vatAmount).toFixed(2));
  const savedAmount = parseFloat(
    (originalPrice - baseSubtotal + groupDiscountAmount + promoDiscountAmount).toFixed(2)
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
  };
}
