import { Router, type IRouter } from "express";
import Stripe from "stripe";
import { eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { bookingsTable, attendeesTable, promoCodesTable } from "@workspace/db";
import { sendBookingEmails, sendOrganiserNotification } from "../lib/email";
import { syncBookingToSheets } from "../lib/google-sheets";
import { logger } from "../lib/logger";

let cachedVatRateId: string | null = null;

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

      const orderRef = existing.orderReference || `HRAS26-${6541 + bookingId}`;

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

router.post("/stripe/confirm-card-payment", async (req, res): Promise<void> => {
  const stripe = getStripe();
  if (!stripe) {
    res.status(500).json({ error: "Stripe is not configured." });
    return;
  }

  const { bookingId, sessionId } = req.body;
  if (!bookingId || !sessionId) {
    res.status(400).json({ error: "bookingId and sessionId are required" });
    return;
  }

  const id = parseInt(bookingId, 10);
  const [existing] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id));

  if (!existing) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  const sessionHeader = req.headers["x-booking-session"] as string | undefined;
  const ownsBooking = sessionHeader && existing.sessionToken && sessionHeader === existing.sessionToken;
  if (!ownsBooking) {
    res.status(403).json({ error: "Forbidden — invalid booking session" });
    return;
  }

  if (existing.status === "paid" || existing.status === "invoiced") {
    logger.info({ bookingId: id, status: existing.status }, "confirm-card-payment: already processed");
    res.json({ alreadyProcessed: true, orderReference: existing.orderReference || "" });
    return;
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      res.status(400).json({ error: "Payment not yet completed" });
      return;
    }

    // Verify this Stripe session was created for this booking (prevents cross-session abuse)
    const sessionBookingId = session.metadata?.bookingId;
    if (!sessionBookingId || String(sessionBookingId) !== String(id)) {
      logger.warn({ bookingId: id, sessionBookingId, sessionId }, "confirm-card-payment: session/booking mismatch");
      res.status(403).json({ error: "Stripe session does not belong to this booking" });
      return;
    }

    // Verify the stored stripeSessionId matches (if we have one)
    if (existing.stripeSessionId && existing.stripeSessionId !== sessionId) {
      logger.warn({ bookingId: id, storedSessionId: existing.stripeSessionId, sessionId }, "confirm-card-payment: sessionId mismatch");
      res.status(403).json({ error: "Stripe session ID does not match booking record" });
      return;
    }

    const orderRef = existing.orderReference || `HRAS26-${6541 + id}`;

    await db.update(bookingsTable).set({
      status: "paid",
      currentStep: 5,
      stripePaymentIntentId: session.payment_intent as string | null,
      orderReference: orderRef,
      paymentMethod: "card",
    }).where(eq(bookingsTable.id, id));

    if (existing.promoCode) {
      await db.update(promoCodesTable)
        .set({ usedCount: sql`${promoCodesTable.usedCount} + 1` })
        .where(eq(promoCodesTable.code, existing.promoCode));
    }

    try { await sendBookingEmails(id); } catch (err) { logger.error({ err, bookingId: id }, "Failed to send booking emails after confirm-card-payment"); }
    try { await sendOrganiserNotification(id); } catch (err) { logger.error({ err, bookingId: id }, "Failed to send organiser notification after confirm"); }
    try { await syncBookingToSheets(id); } catch (err) { logger.error({ err, bookingId: id }, "Failed to sync to Google Sheets after confirm"); }

    logger.info({ bookingId: id, orderRef }, "confirm-card-payment: booking confirmed and emails sent");
    res.json({ alreadyProcessed: false, orderReference: orderRef });
  } catch (err: any) {
    const msg = err?.raw?.message || err?.message || "Stripe error";
    logger.error({ err, bookingId: id }, "confirm-card-payment: failed to retrieve session");
    res.status(502).json({ error: `Failed to verify payment: ${msg}` });
  }
});

async function getOrCreateVatRate(stripe: Stripe): Promise<string | null> {
  if (cachedVatRateId) return cachedVatRateId;
  try {
    const list = await stripe.taxRates.list({ limit: 20, active: true });
    const existing = list.data.find(
      (r) => r.percentage === 20 && r.country === "GB" && r.inclusive === false
    );
    if (existing) {
      cachedVatRateId = existing.id;
      return existing.id;
    }
    const created = await stripe.taxRates.create({
      display_name: "VAT",
      percentage: 20,
      country: "GB",
      inclusive: false,
      description: "UK VAT 20%",
    });
    cachedVatRateId = created.id;
    return created.id;
  } catch (err) {
    logger.error({ err }, "Failed to get/create Stripe VAT tax rate");
    return null;
  }
}


router.post("/stripe/create-invoice", async (req, res): Promise<void> => {
  const stripe = getStripe();
  if (!stripe) {
    res.status(500).json({ error: "Stripe is not configured. Set STRIPE_SECRET_KEY." });
    return;
  }

  const { bookingId } = req.body;
  if (!bookingId) {
    res.status(400).json({ error: "bookingId is required" });
    return;
  }

  const id = parseInt(bookingId, 10);
  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id));

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

  if (booking.status === "paid" || (booking.status === "invoiced" && booking.stripeInvoiceId)) {
    res.json({
      invoiceId: booking.stripeInvoiceId || `manual-${booking.orderReference}`,
      invoiceUrl: booking.stripeInvoicePdfUrl || null,
      paymentUrl: booking.stripeInvoicePaymentUrl || null,
      invoiceReference: booking.orderReference || "",
      alreadyProcessed: true,
    });
    return;
  }

  const attendees = await db.select().from(attendeesTable).where(eq(attendeesTable.bookingId, id));
  const lead = attendees.find((a) => a.isLead) || attendees[0];

  if (!lead) {
    res.status(400).json({ error: "No attendee found for booking" });
    return;
  }

  const passLabels: Record<string, string> = {
    single: "Single Pass — HR Analytics Summit 2026",
    team: "Team Pass (3 Seats) — HR Analytics Summit 2026",
    business: "Business Pass — HR Analytics Summit 2026",
  };

  const orderRef = booking.orderReference || `HRAS26-${6541 + id}`;

  const subtotalAfterDiscounts = parseFloat(booking.subtotalAmount?.toString() || "0");
  const groupDiscount = parseFloat(booking.groupDiscountAmount?.toString() || "0");
  const promoDiscount = parseFloat(booking.promoDiscountAmount?.toString() || "0");
  const baseAmount = subtotalAfterDiscounts + groupDiscount + promoDiscount;

  const contactEmail = booking.billingEmail || lead.workEmail;
  const contactName = booking.billingName || `${lead.firstName} ${lead.lastName}`;
  const contactCompany = booking.billingCompany || lead.company;

  try {
    const customerList = await stripe.customers.list({ email: contactEmail, limit: 1 });
    let customer: Stripe.Customer;
    if (customerList.data.length > 0) {
      customer = customerList.data[0];
    } else {
      customer = await stripe.customers.create({
        email: contactEmail,
        name: contactName,
        metadata: { company: contactCompany || "" },
        address: booking.billingAddressLine1 ? {
          line1: booking.billingAddressLine1,
          line2: booking.billingAddressLine2 || undefined,
          city: booking.billingTown || undefined,
          state: booking.billingRegion || undefined,
          postal_code: booking.billingPostcode || undefined,
          country: booking.billingCountry === "United Kingdom" ? "GB" : (booking.billingCountry || "GB"),
        } : undefined,
      });
    }

    const vatRateId = await getOrCreateVatRate(stripe);
    if (!vatRateId) {
      res.status(500).json({ error: "Could not establish UK VAT 20% tax rate in Stripe. Invoice not created." });
      return;
    }
    const vatParams = { tax_rates: [vatRateId] };

    const invoiceObj = await stripe.invoices.create({
      customer: customer.id,
      collection_method: "send_invoice",
      days_until_due: 14,
      description: `HR Analytics Summit 2026 — ${orderRef}`,
      footer: "Issued by Dynamic Business Leaders Limited · Co. No. 12252258 · VAT No. 336124621 · Registered: 45 Lemsford Village, Welwyn Garden City, Hertfordshire AL8 7TR · Bank: Tide (ClearBank) · Sort: 04-06-05 · AC: 16963209 · IBAN (GBP): GB65CLRB04060516963209 · SWIFT: CLRBGB22 · IBAN (EUR): GB45TCCL00997990500906 · BIC: TCCLGB31",
      custom_fields: [
        { name: "Company Number", value: "12252258" },
        { name: "VAT Number", value: "336124621" },
        { name: "Contact", value: "douglas@dynamicbusinessleaders.co.uk" },
        { name: "Goods", value: "Conference" },
      ],
      metadata: { bookingId: String(id), orderRef },
      auto_advance: false,
    });

    await stripe.invoiceItems.create({
      customer: customer.id,
      invoice: invoiceObj.id,
      description: `${passLabels[booking.passType] || booking.passType} × ${booking.quantity}`,
      amount: Math.round(baseAmount * 100),
      currency: "gbp",
      ...vatParams,
    });

    if (groupDiscount > 0) {
      await stripe.invoiceItems.create({
        customer: customer.id,
        invoice: invoiceObj.id,
        description: "Group Discount",
        amount: -Math.round(groupDiscount * 100),
        currency: "gbp",
        ...vatParams,
      });
    }

    if (promoDiscount > 0) {
      await stripe.invoiceItems.create({
        customer: customer.id,
        invoice: invoiceObj.id,
        description: `Promo Code: ${booking.promoCode}`,
        amount: -Math.round(promoDiscount * 100),
        currency: "gbp",
        ...vatParams,
      });
    }

    const finalized = await stripe.invoices.finalizeInvoice(invoiceObj.id);
    const sent = await stripe.invoices.sendInvoice(finalized.id);

    const invoiceId = sent.id;
    const invoicePdfUrl = sent.invoice_pdf || null;
    const invoicePaymentUrl = sent.hosted_invoice_url || null;

    await db.update(bookingsTable).set({
      status: "invoiced",
      currentStep: 5,
      orderReference: orderRef,
      paymentMethod: "invoice",
      stripeInvoiceId: invoiceId,
      stripeInvoicePdfUrl: invoicePdfUrl,
      stripeInvoicePaymentUrl: invoicePaymentUrl,
    }).where(eq(bookingsTable.id, id));

    if (booking.promoCode) {
      await db.update(promoCodesTable)
        .set({ usedCount: sql`${promoCodesTable.usedCount} + 1` })
        .where(eq(promoCodesTable.code, booking.promoCode));
    }

    try { await sendBookingEmails(id); } catch (err) { logger.error({ err }, "Failed to send booking emails after Stripe invoice"); }
    try { await sendOrganiserNotification(id); } catch (err) { logger.error({ err }, "Failed to send organiser notification"); }
    try { await syncBookingToSheets(id); } catch (err) { logger.error({ err }, "Failed to sync to Google Sheets"); }

    res.json({ invoiceId, invoiceUrl: invoicePdfUrl, paymentUrl: invoicePaymentUrl, invoiceReference: orderRef });
  } catch (err: any) {
    const msg = err?.raw?.message || err?.message || "Stripe error";
    logger.error({ err, bookingId: id }, "Failed to create Stripe invoice");
    res.status(502).json({ error: `Failed to create invoice: ${msg}` });
  }
});

export default router;
