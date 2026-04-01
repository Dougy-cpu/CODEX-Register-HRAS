import { Router, type IRouter } from "express";
import { eq, and, lte, gte, or, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { promoCodesTable, bookingsTable } from "@workspace/db";
import { calculatePricing, PASS_PRICES } from "../lib/pricing";

const router: IRouter = Router();

function formatPromoCode(p: typeof promoCodesTable.$inferSelect) {
  return {
    ...p,
    discountValue: parseFloat(p.discountValue.toString()),
    validFrom: p.validFrom ? p.validFrom.toISOString() : null,
    validUntil: p.validUntil ? p.validUntil.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
  };
}

router.post("/promo-codes/validate", async (req, res): Promise<void> => {
  const { code, passType, quantity } = req.body;

  if (!code || !passType || !quantity) {
    res.status(400).json({ error: "code, passType, and quantity are required" });
    return;
  }

  const now = new Date();
  const [promo] = await db
    .select()
    .from(promoCodesTable)
    .where(
      and(
        eq(promoCodesTable.code, (code as string).toUpperCase()),
        eq(promoCodesTable.isActive, true),
        or(isNull(promoCodesTable.validFrom), lte(promoCodesTable.validFrom, now)),
        or(isNull(promoCodesTable.validUntil), gte(promoCodesTable.validUntil, now))
      )
    );

  if (!promo) {
    res.status(400).json({ error: "Invalid or expired promo code" });
    return;
  }

  if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) {
    res.status(400).json({ error: "This promo code has reached its maximum usage limit" });
    return;
  }

  if (promo.applicablePassTypes && !promo.applicablePassTypes.includes(passType as string)) {
    const allowed = promo.applicablePassTypes.map((t: string) => t === "single" ? "Single Pass" : "Business Pass").join(" and ");
    res.status(400).json({ error: `This promo code is only valid for ${allowed}` });
    return;
  }

  const passInfo = PASS_PRICES[passType as string];
  if (!passInfo) {
    res.status(400).json({ error: "Invalid pass type" });
    return;
  }

  const baseSubtotal = passInfo.price * parseInt(quantity, 10);
  let discountAmount = 0;

  if (promo.discountType === "percentage") {
    discountAmount = parseFloat(((baseSubtotal * parseFloat(promo.discountValue.toString())) / 100).toFixed(2));
  } else {
    discountAmount = Math.min(parseFloat(promo.discountValue.toString()), baseSubtotal);
  }

  res.json({
    valid: true,
    code: promo.code,
    discountType: promo.discountType,
    discountValue: parseFloat(promo.discountValue.toString()),
    discountAmount,
    message: promo.description || null,
  });
});

export default router;
