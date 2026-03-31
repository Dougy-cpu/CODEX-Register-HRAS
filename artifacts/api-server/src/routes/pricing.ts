import { Router, type IRouter } from "express";
import { calculatePricing } from "../lib/pricing";

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

export default router;
