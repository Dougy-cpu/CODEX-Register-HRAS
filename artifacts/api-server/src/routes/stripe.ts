import { Router, type IRouter } from "express";
import Stripe from "stripe";
import { eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { bookingsTable, promoCodesTable } from "@workspace/db";
import { sendBookingEmails, sendOrganiserNotification } from "../lib/email";
import { syncBookingToSheets } from "../lib/google-sheets";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

router.post("/stripe/create-checkout-session", async (req, res): Promise<void> => {
  const stripe = getStripe();
  if (!stripe) {
    res.status(500).json({ error: "Stripe is not configured. Set STRIPE_SECRET_KEY." });
    return;
  }

  const { bookingId, successUrl, cancelUrl } = req.body;

  if (!bookingId || !successUrl || !cancelUrl) {
    res.status(400).json({ error: "bookingId, successUrl, and cancelUrl are required" });
    return;
  }

  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, parseInt(bookingId, 10)));

  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  const sessionHeader = req.headers["x-booking-session"] as string | undefined;
  const ownsBooking = sessionHeader && booking.sessionToken && sessionHeader === booking.sessionToken;
  if (!ownsBooking) {
    res.status(403).json({ error: "Forbidden — invalid booking session" });
    return;
  }

  const passLabels: Record<string, string> = {
    single: "Single Pass — HR Analytics Summit 2026",
    team: "Team Pass (3 Seats) — HR Analytics Summit 2026",
    business: "Business Pass — HR Analytics Summit 2026",
  };

  const subtotalAfterDiscounts = parseFloat(booking.subtotalAmount?.toString() || "0");
  const vatAmount = parseFloat(booking.vatAmount?.toString() || "0");

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      price_data: {
        currency: "gbp",
        product_data: {
          name: passLabels[booking.passType] || booking.passType,
          description: `3 September 2026 · 155 Bishopsgate, London · ${booking.quantity} ${booking.quantity === 1 ? "pass" : "passes"}`,
        },
        unit_amount: Math.round(subtotalAfterDiscounts * 100),
      },
      quantity: 1,
    },
    {
      price_data: {
        currency: "gbp",
        product_data: {
          name: "VAT (20%)",
        },
        unit_amount: Math.round(vatAmount * 100),
      },
      quantity: 1,
    },
  ];

  let session: import("stripe").Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        bookingId: String(bookingId),
      },
      customer_email: booking.billingEmail || undefined,
    });
  } catch (err: any) {
    const stripeMessage = err?.raw?.message || err?.message || "Stripe error";
    logger.error({ err, bookingId }, "Stripe checkout session creation failed");
    res.status(502).json({ error: `Payment provider error: ${stripeMessage}` });
    return;
  }

  await db
    .update(bookingsTable)
    .set({ stripeSessionId: session.id, status: "pending_payment" })
    .where(eq(bookingsTable.id, booking.id));

  res.json({ sessionId: session.id, url: session.url });
});

router.post("/stripe/webhook", async (req, res): Promise<void> => {
  const stripe = getStripe();
  if (!stripe) {
    res.status(200).json({ received: true });
    return;
  }

  const sig = req.headers["stripe-signature"] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;

  try {
    if (webhookSecret && sig) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else if (process.env.NODE_ENV === "production") {
      logger.error("STRIPE_WEBHOOK_SECRET is not set in production — rejecting webhook");
      res.status(400).json({ error: "Webhook not configured — set STRIPE_WEBHOOK_SECRET" });
      return;
    } else {
      logger.warn("STRIPE_WEBHOOK_SECRET not set — accepting without verification (dev only)");
      const raw = Buffer.isBuffer(req.body) ? req.body.toString() : req.body;
      event = (typeof raw === "string" ? JSON.parse(raw) : raw) as Stripe.Event;
    }
  } catch (err) {
    logger.error({ err }, "Webhook signature verification failed");
    res.status(400).json({ error: "Webhook error" });
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const bookingId = parseInt(session.metadata?.bookingId || "0", 10);

    if (bookingId) {
      const [existing] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));

      if (!existing) {
        logger.warn({ bookingId }, "Stripe webhook: booking not found, skipping");
        res.json({ received: true });
        return;
      }

      if (existing.status === "paid" || existing.status === "invoiced") {
        logger.info({ bookingId, status: existing.status }, "Stripe webhook: already processed, skipping duplicate event");
        res.json({ received: true });
        return;
      }

      const prefix = "HRS";
      const num = Math.floor(10000 + Math.random() * 90000);
      const orderRef = existing.orderReference || `${prefix}-2026-${num}`;

      await db
        .update(bookingsTable)
        .set({
          status: "paid",
          currentStep: 5,
          stripePaymentIntentId: session.payment_intent as string,
          orderReference: orderRef,
          paymentMethod: "card",
        })
        .where(eq(bookingsTable.id, bookingId));

      if (existing.promoCode) {
        await db.update(promoCodesTable)
          .set({ usedCount: sql`${promoCodesTable.usedCount} + 1` })
          .where(eq(promoCodesTable.code, existing.promoCode));
      }

      try {
        await sendBookingEmails(bookingId);
      } catch (err) {
        logger.error({ err, bookingId }, "Failed to send booking emails after payment");
      }

      try {
        await sendOrganiserNotification(bookingId);
      } catch (err) {
        logger.error({ err, bookingId }, "Failed to send organiser notification after payment");
      }

      try {
        await syncBookingToSheets(bookingId);
      } catch (err) {
        logger.error({ err, bookingId }, "Failed to sync booking to Google Sheets");
      }
    }
  }

  res.json({ received: true });
});

export default router;
