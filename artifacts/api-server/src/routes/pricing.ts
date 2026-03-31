import { Router, type IRouter } from "express";
import { calculatePricing } from "../lib/pricing";
import { db } from "@workspace/db";
import { passInventoryTable } from "@workspace/db";

const router: IRouter = Router();

router.post("/pricing/calculate", async (req, res): Promise<void> => {
  const { passType, quantity, promoCode } = req.body;

  if (!passType || !quantity) {
    res.status(400).json({ error: "passType and quantity are required" });
    return;
  }

  const pricing = await calculatePricing(passType, parseInt(quantity, 10), promoCode);
  res.json(pricing);
});

router.get("/passes/inventory", async (_req, res): Promise<void> => {
  const rows = await db.select().from(passInventoryTable);
  const result: Record<string, number | null> = { single: null, business: null };
  for (const row of rows) {
    result[row.passType] = row.remaining;
  }
  res.json(result);
});

export default router;
