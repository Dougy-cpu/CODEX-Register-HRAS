import { Router, type IRouter } from "express";
import Stripe from "stripe";
import { eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { bookingsTable, attendeesTable, promoCodesTable } from "@workspace/db";
import {
  sendBookingEmails,
  sendOrganiserNotification,
  sendCheckoutExpiredEmail,
  sendRefundConfirmationEmail,
  sendInvoicePaymentFailedEmail,
  sendDisputeAlertEmail,
} from "../lib/email";
import { syncBookingToSheets } from "../lib/google-sheets";
import { logger } from "../lib/logger";

const DECLINE_CODE_LABELS: Record<string, string> = {
  authentication_required: "Strong customer authentication required — please retry your payment",
  card_declined: "Card declined by your bank",
  do_not_honor: "Card declined — please contact your bank",
  expired_card: "Card has expired",
  fraudulent: "Suspected fraudulent activity — please contact your bank",
  generic_decline: "Card declined",
  incorrect_cvc: "Incorrect security code (CVC)",
  insufficient_funds: "Insufficient funds",
  invalid_account: "Invalid account",
  lost_card: "Card reported lost — please contact your bank",
  new_account_information_available: "Card details have changed — please use your updated card",
  no_action_taken: "Card declined — no action taken by bank",
  not_permitted: "This card type is not permitted for this transaction",
  restricted_card: "Card is restricted",
  stolen_card: "Card reported stolen — please contact your bank",
  transaction_not_allowed: "Transaction not allowed on this card",
};

const DISPUTE_REASON_LABELS: Record<string, string> = {
  credit_not_processed: "Credit not processed",
  duplicate: "Duplicate charge",
  fraudulent: "Fraudulent",
  general: "General",
  product_not_received: "Product / service not received",
  product_unacceptable: "Product / service unacceptable",
  subscription_canceled: "Subscription cancelled",
  unrecognized: "Unrecognised transaction",
};

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

  // When someone pays a Stripe invoice (e.g. via the hosted payment link), automatically
  // flip the booking status from "invoiced" → "paid". Confirmation emails were already
  // sent at invoice creation so we don't resend them here.
  if (event.type === "invoice.paid") {
    const invoice = event.data.object as Stripe.Invoice;
    const invoiceId = invoice.id;

    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.stripeInvoiceId, invoiceId));

    if (!booking) {
      // Could be an invoice unrelated to this system — ignore silently
      logger.info({ invoiceId }, "invoice.paid: no matching booking found, skipping");
      res.json({ received: true });
      return;
    }

    if (booking.status === "paid") {
      logger.info({ bookingId: booking.id, invoiceId }, "invoice.paid: already marked paid, skipping");
      res.json({ received: true });
      return;
    }

    await db
      .update(bookingsTable)
      .set({ status: "paid", updatedAt: new Date() })
      .where(eq(bookingsTable.id, booking.id));

    logger.info({ bookingId: booking.id, invoiceId, orderRef: booking.orderReference }, "invoice.paid: booking marked as paid");

    // Re-sync to Google Sheets so the status column reflects "paid"
    try {
      await syncBookingToSheets(booking.id);
    } catch (err) {
      logger.error({ err, bookingId: booking.id }, "invoice.paid: failed to re-sync to Google Sheets");
    }

    // Notify the organiser that the invoice has been settled
    try {
      await sendOrganiserNotification(booking.id);
    } catch (err) {
      logger.error({ err, bookingId: booking.id }, "invoice.paid: failed to send organiser notification");
    }
  }

  // Stripe Checkout session expired without payment — reset booking to "partial" so
  // the customer can retry, and email them to let them know.
  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    const bookingId = parseInt(session.metadata?.bookingId || "0", 10);

    if (bookingId) {
      const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));

      if (booking && booking.status === "pending_payment") {
        await db
          .update(bookingsTable)
          .set({ status: "partial", stripeSessionId: null, updatedAt: new Date() })
          .where(eq(bookingsTable.id, bookingId));

        logger.info({ bookingId }, "checkout.session.expired: booking reset to partial");

        try {
          await sendCheckoutExpiredEmail(bookingId);
        } catch (err) {
          logger.error({ err, bookingId }, "checkout.session.expired: failed to send expired email");
        }
      }
    }
  }

  // A charge was refunded — mark the booking as cancelled and email the customer.
  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;

    if (paymentIntentId) {
      const [booking] = await db
        .select()
        .from(bookingsTable)
        .where(eq(bookingsTable.stripePaymentIntentId, paymentIntentId));

      if (booking && booking.status !== "cancelled") {
        await db
          .update(bookingsTable)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(eq(bookingsTable.id, booking.id));

        logger.info({ bookingId: booking.id, paymentIntentId, refunded: charge.amount_refunded }, "charge.refunded: booking cancelled");

        try {
          await sendRefundConfirmationEmail(booking.id, charge.amount_refunded);
        } catch (err) {
          logger.error({ err, bookingId: booking.id }, "charge.refunded: failed to send refund confirmation email");
        }

        try {
          await syncBookingToSheets(booking.id);
        } catch (err) {
          logger.error({ err, bookingId: booking.id }, "charge.refunded: failed to re-sync to Google Sheets");
        }
      }
    }
  }

  // Stripe invoice payment attempt failed — email the customer with the specific decline reason.
  if (event.type === "invoice.payment_failed") {
    const stripe = getStripe();
    const invoice = event.data.object as Stripe.Invoice;
    const invoiceId = invoice.id;

    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.stripeInvoiceId, invoiceId));

    if (booking) {
      // Attempt to retrieve the payment intent to get the specific decline reason
      let declineReason: string | undefined;
      const piId = typeof invoice.payment_intent === "string" ? invoice.payment_intent : null;
      if (piId && stripe) {
        try {
          const pi = await stripe.paymentIntents.retrieve(piId);
          const err = pi.last_payment_error;
          if (err) {
            const code = err.decline_code || err.code || "";
            declineReason = DECLINE_CODE_LABELS[code] || err.message || undefined;
          }
        } catch (piErr) {
          logger.warn({ piErr, piId }, "invoice.payment_failed: could not retrieve payment intent for decline reason");
        }
      }

      const attemptCount = invoice.attempt_count ?? undefined;
      logger.info({ bookingId: booking.id, invoiceId, declineReason, attemptCount }, "invoice.payment_failed: notifying customer");

      try {
        await sendInvoicePaymentFailedEmail(booking.id, declineReason, attemptCount);
      } catch (err) {
        logger.error({ err, bookingId: booking.id }, "invoice.payment_failed: failed to send notification email");
      }
    }
  }

  // A payment dispute (chargeback) has been filed — mark booking disputed and alert organisers urgently.
  if (event.type === "dispute.created") {
    const dispute = event.data.object as Stripe.Dispute;
    const piId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : null;

    if (piId) {
      const [booking] = await db
        .select()
        .from(bookingsTable)
        .where(eq(bookingsTable.stripePaymentIntentId, piId));

      if (booking) {
        await db
          .update(bookingsTable)
          .set({ status: "disputed", updatedAt: new Date() })
          .where(eq(bookingsTable.id, booking.id));

        const reasonLabel = DISPUTE_REASON_LABELS[dispute.reason] || dispute.reason || "Unknown";
        const dueBy = dispute.evidence_details?.due_by
          ? new Date(dispute.evidence_details.due_by * 1000)
          : null;

        logger.info({ bookingId: booking.id, disputeId: dispute.id, reason: dispute.reason, dueBy }, "dispute.created: booking marked as disputed");

        try {
          await sendDisputeAlertEmail(booking.id, dispute.id, dispute.amount, reasonLabel, dueBy);
        } catch (err) {
          logger.error({ err, bookingId: booking.id, disputeId: dispute.id }, "dispute.created: failed to send alert email");
        }

        try {
          await syncBookingToSheets(booking.id);
        } catch (err) {
          logger.error({ err, bookingId: booking.id }, "dispute.created: failed to re-sync to Google Sheets");
        }
      } else {
        logger.info({ piId, disputeId: dispute.id }, "dispute.created: no matching booking found, skipping");
      }
    }
  }

  // A card payment attempt failed during Stripe Checkout — log the decline code for admin visibility.
  // No status change; Stripe Checkout handles retries inline so no customer email is sent here.
  if (event.type === "payment_intent.payment_failed") {
    const pi = event.data.object as Stripe.PaymentIntent;
    const piId = pi.id;
    const err = pi.last_payment_error;
    const declineCode = err?.decline_code || err?.code || "unknown";
    const declineMessage = DECLINE_CODE_LABELS[declineCode] || err?.message || "Unknown reason";

    // Try to identify the booking for richer log context
    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.stripePaymentIntentId, piId));

    logger.info(
      { piId, declineCode, declineMessage, bookingId: booking?.id ?? null },
      "payment_intent.payment_failed: card decline logged",
    );
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
      footer: [
        "Issued by: Dynamic Business Leaders Limited",
        "Company No. 12252258  |  VAT No. 336124621",
        "Registered Address: 45 Lemsford Village, Welwyn Garden City, Hertfordshire AL8 7TR",
        "Contact: douglas@dynamicbusinessleaders.co.uk  |  Tel: 07763618052",
        "Goods: Conference",
        "",
        "Bank: Tide (ClearBank)  |  Sort Code: 04-06-05  |  Account: 16963209",
        "IBAN (GBP): GB65CLRB04060516963209  |  SWIFT: CLRBGB22",
        "IBAN (EUR): GB45TCCL00997990500906  |  BIC: TCCLGB31",
      ].join("\n"),
      custom_fields: [
        { name: "Booking Reference", value: orderRef },
        { name: "Company Number", value: "12252258" },
        { name: "VAT Number", value: "336124621" },
        { name: "Contact", value: "douglas@dynamicbusinessleaders.co.uk" },
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
