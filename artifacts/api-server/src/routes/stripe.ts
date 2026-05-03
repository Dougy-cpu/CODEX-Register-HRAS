import { Router, type IRouter } from "express";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { bookingsTable, attendeesTable, promoCodesTable } from "@workspace/db";
import { isCodeUsedByEmail } from "./promo-codes";
import { incrementPromoUsage } from "../lib/pricing";
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
import { reissueBookingInvoice } from "../lib/invoice";

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

const router: IRouter = Router();

async function isPromoOncePerCustomerViolation(
  bookingId: number,
  promoCode: string | null,
): Promise<boolean> {
  if (!promoCode) return false;
  const [promo] = await db
    .select()
    .from(promoCodesTable)
    .where(eq(promoCodesTable.code, promoCode));
  if (!promo?.oncePerCustomer) return false;
  const allAttendees = await db
    .select()
    .from(attendeesTable)
    .where(eq(attendeesTable.bookingId, bookingId));
  const leadAttendee = allAttendees.find((a) => a.isLead) || allAttendees[0];
  const email = (leadAttendee?.workEmail || "").trim().toLowerCase();
  if (!email) return false;
  return await isCodeUsedByEmail(promoCode, email, bookingId);
}

export function getStripe() {
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
  const ownsBooking =
    sessionHeader && booking.sessionToken && sessionHeader === booking.sessionToken;
  if (!ownsBooking) {
    res.status(403).json({ error: "Forbidden — invalid booking session" });
    return;
  }

  if (await isPromoOncePerCustomerViolation(booking.id, booking.promoCode)) {
    res.status(400).json({
      error: "This promo code has already been used on a previous booking with this email",
    });
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
  } catch (err) {
    const e = err as { raw?: { message?: string }; message?: string };
    const stripeMessage = e?.raw?.message || e?.message || "Stripe error";
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
      const [existing] = await db
        .select()
        .from(bookingsTable)
        .where(eq(bookingsTable.id, bookingId));

      if (!existing) {
        logger.warn({ bookingId }, "Stripe webhook: booking not found, skipping");
        res.json({ received: true });
        return;
      }

      if (existing.status === "paid" || existing.status === "invoiced") {
        logger.info(
          { bookingId, status: existing.status },
          "Stripe webhook: already processed, skipping duplicate event",
        );
        res.json({ received: true });
        return;
      }

      const orderRef = existing.orderReference || `HRAS26-${6541 + bookingId}`;

      // Mark the booking paid AND bump the promo counter inside one
      // transaction so a crash between the two writes can never leave the
      // database with an inconsistent (paid-but-unincremented) state.
      await db.transaction(async (tx) => {
        await tx
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
          const reserved = await incrementPromoUsage(existing.promoCode, existing.quantity, tx);
          if (!reserved) {
            // The customer has already paid — confirm the booking and just log
            // that the cap was technically exceeded so the organiser can review.
            // We deliberately do NOT throw, so the transaction still commits
            // the status update.
            logger.warn(
              { bookingId, promoCode: existing.promoCode, quantity: existing.quantity },
              "Promo cap exceeded after successful card payment — booking confirmed but usage not incremented",
            );
          }
        }
      });

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
      logger.info(
        { bookingId: booking.id, invoiceId },
        "invoice.paid: already marked paid, skipping",
      );
      res.json({ received: true });
      return;
    }

    const rawPaymentIntent = (invoice as unknown as Record<string, unknown>).payment_intent;
    const paymentIntentId: string | null =
      typeof rawPaymentIntent === "string"
        ? rawPaymentIntent
        : rawPaymentIntent && typeof rawPaymentIntent === "object" && "id" in rawPaymentIntent
          ? (rawPaymentIntent as { id: string }).id
          : null;

    await db
      .update(bookingsTable)
      .set({
        status: "paid",
        updatedAt: new Date(),
        ...(paymentIntentId
          ? { paymentMethod: "card" as const, stripePaymentIntentId: paymentIntentId }
          : {}),
      })
      .where(eq(bookingsTable.id, booking.id));

    logger.info(
      {
        bookingId: booking.id,
        invoiceId,
        orderRef: booking.orderReference,
        paymentIntentId,
        paymentMethod: paymentIntentId ? "card" : booking.paymentMethod,
      },
      "invoice.paid: booking marked as paid",
    );

    // Re-sync to Google Sheets so the status column reflects "paid"
    try {
      await syncBookingToSheets(booking.id);
    } catch (err) {
      logger.error(
        { err, bookingId: booking.id },
        "invoice.paid: failed to re-sync to Google Sheets",
      );
    }

    // Notify the organiser that the invoice has been settled
    try {
      await sendOrganiserNotification(booking.id);
    } catch (err) {
      logger.error(
        { err, bookingId: booking.id },
        "invoice.paid: failed to send organiser notification",
      );
    }
  }

  // Stripe Checkout session expired without payment — reset booking to "partial" so
  // the customer can retry, and email them to let them know.
  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    const bookingId = parseInt(session.metadata?.bookingId || "0", 10);

    if (bookingId) {
      const [booking] = await db
        .select()
        .from(bookingsTable)
        .where(eq(bookingsTable.id, bookingId));

      if (booking && booking.status === "pending_payment") {
        await db
          .update(bookingsTable)
          .set({ status: "partial", stripeSessionId: null, updatedAt: new Date() })
          .where(eq(bookingsTable.id, bookingId));

        logger.info({ bookingId }, "checkout.session.expired: booking reset to partial");

        try {
          await sendCheckoutExpiredEmail(bookingId);
        } catch (err) {
          logger.error(
            { err, bookingId },
            "checkout.session.expired: failed to send expired email",
          );
        }
      }
    }
  }

  // A charge was refunded — mark the booking as refunded and email the customer, but only for full refunds.
  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const paymentIntentId =
      typeof charge.payment_intent === "string" ? charge.payment_intent : null;
    const isFullRefund = charge.refunded === true || charge.amount_refunded >= charge.amount;

    if (paymentIntentId) {
      const [booking] = await db
        .select()
        .from(bookingsTable)
        .where(eq(bookingsTable.stripePaymentIntentId, paymentIntentId));

      if (booking && !isFullRefund) {
        logger.info(
          {
            bookingId: booking.id,
            paymentIntentId,
            amountRefunded: charge.amount_refunded,
            total: charge.amount,
          },
          "charge.refunded: partial refund — booking status unchanged",
        );
      } else if (booking && isFullRefund && booking.status !== "refunded") {
        await db
          .update(bookingsTable)
          .set({ status: "refunded", updatedAt: new Date() })
          .where(eq(bookingsTable.id, booking.id));

        logger.info(
          { bookingId: booking.id, paymentIntentId, amountRefunded: charge.amount_refunded },
          "charge.refunded: full refund — booking marked refunded",
        );

        try {
          await sendRefundConfirmationEmail(booking.id, charge.amount_refunded);
        } catch (err) {
          logger.error(
            { err, bookingId: booking.id },
            "charge.refunded: failed to send refund confirmation email",
          );
        }

        try {
          await syncBookingToSheets(booking.id);
        } catch (err) {
          logger.error(
            { err, bookingId: booking.id },
            "charge.refunded: failed to re-sync to Google Sheets",
          );
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
      const piId =
        typeof (invoice as unknown as Record<string, unknown>).payment_intent === "string"
          ? ((invoice as unknown as Record<string, unknown>).payment_intent as string)
          : null;
      if (piId && stripe) {
        try {
          const pi = await stripe.paymentIntents.retrieve(piId);
          const err = pi.last_payment_error;
          if (err) {
            const code = err.decline_code || err.code || "";
            declineReason = DECLINE_CODE_LABELS[code] || err.message || undefined;
          }
        } catch (piErr) {
          logger.warn(
            { piErr, piId },
            "invoice.payment_failed: could not retrieve payment intent for decline reason",
          );
        }
      }

      const attemptCount = invoice.attempt_count ?? undefined;
      logger.info(
        { bookingId: booking.id, invoiceId, declineReason, attemptCount },
        "invoice.payment_failed: notifying customer",
      );

      try {
        await sendInvoicePaymentFailedEmail(booking.id, declineReason, attemptCount);
      } catch (err) {
        logger.error(
          { err, bookingId: booking.id },
          "invoice.payment_failed: failed to send notification email",
        );
      }
    }
  }

  // A payment dispute (chargeback) has been filed — mark booking disputed and alert organisers urgently.
  if (event.type === "charge.dispute.created") {
    const stripe = getStripe();
    const dispute = event.data.object as Stripe.Dispute;

    // Resolve the payment intent ID — try the dispute object first, fall back to retrieving the charge
    let piId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : null;
    if (!piId && stripe) {
      const chargeId = typeof dispute.charge === "string" ? dispute.charge : null;
      if (chargeId) {
        try {
          const charge = await stripe.charges.retrieve(chargeId);
          piId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
        } catch (chargeErr) {
          logger.warn(
            { chargeErr, chargeId },
            "charge.dispute.created: could not retrieve charge to resolve payment intent",
          );
        }
      }
    }

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

        logger.info(
          { bookingId: booking.id, disputeId: dispute.id, reason: dispute.reason, dueBy },
          "dispute.created: booking marked as disputed",
        );

        try {
          await sendDisputeAlertEmail(booking.id, dispute.id, dispute.amount, reasonLabel, dueBy);
        } catch (err) {
          logger.error(
            { err, bookingId: booking.id, disputeId: dispute.id },
            "dispute.created: failed to send alert email",
          );
        }

        try {
          await syncBookingToSheets(booking.id);
        } catch (err) {
          logger.error(
            { err, bookingId: booking.id },
            "dispute.created: failed to re-sync to Google Sheets",
          );
        }
      } else {
        logger.info(
          { piId, disputeId: dispute.id },
          "dispute.created: no matching booking found, skipping",
        );
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
  const ownsBooking =
    sessionHeader && existing.sessionToken && sessionHeader === existing.sessionToken;
  if (!ownsBooking) {
    res.status(403).json({ error: "Forbidden — invalid booking session" });
    return;
  }

  if (existing.status === "paid" || existing.status === "invoiced") {
    logger.info(
      { bookingId: id, status: existing.status },
      "confirm-card-payment: already processed",
    );
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
      logger.warn(
        { bookingId: id, sessionBookingId, sessionId },
        "confirm-card-payment: session/booking mismatch",
      );
      res.status(403).json({ error: "Stripe session does not belong to this booking" });
      return;
    }

    // Verify the stored stripeSessionId matches (if we have one)
    if (existing.stripeSessionId && existing.stripeSessionId !== sessionId) {
      logger.warn(
        { bookingId: id, storedSessionId: existing.stripeSessionId, sessionId },
        "confirm-card-payment: sessionId mismatch",
      );
      res.status(403).json({ error: "Stripe session ID does not match booking record" });
      return;
    }

    const orderRef = existing.orderReference || `HRAS26-${6541 + id}`;

    // Atomic: status flip + promo counter increment commit together.
    await db.transaction(async (tx) => {
      await tx
        .update(bookingsTable)
        .set({
          status: "paid",
          currentStep: 5,
          stripePaymentIntentId: session.payment_intent as string | null,
          orderReference: orderRef,
          paymentMethod: "card",
        })
        .where(eq(bookingsTable.id, id));

      if (existing.promoCode) {
        const reserved = await incrementPromoUsage(existing.promoCode, existing.quantity, tx);
        if (!reserved) {
          // Customer has already paid — log but do not throw, so the status
          // update still commits.
          logger.warn(
            { bookingId: id, promoCode: existing.promoCode, quantity: existing.quantity },
            "Promo cap exceeded after successful card payment — booking confirmed but usage not incremented",
          );
        }
      }
    });

    try {
      await sendBookingEmails(id);
    } catch (err) {
      logger.error(
        { err, bookingId: id },
        "Failed to send booking emails after confirm-card-payment",
      );
    }
    try {
      await sendOrganiserNotification(id);
    } catch (err) {
      logger.error({ err, bookingId: id }, "Failed to send organiser notification after confirm");
    }
    try {
      await syncBookingToSheets(id);
    } catch (err) {
      logger.error({ err, bookingId: id }, "Failed to sync to Google Sheets after confirm");
    }

    logger.info(
      { bookingId: id, orderRef },
      "confirm-card-payment: booking confirmed and emails sent",
    );
    res.json({ alreadyProcessed: false, orderReference: orderRef });
  } catch (err) {
    const e = err as { raw?: { message?: string }; message?: string };
    const msg = e?.raw?.message || e?.message || "Stripe error";
    logger.error({ err, bookingId: id }, "confirm-card-payment: failed to retrieve session");
    res.status(502).json({ error: `Failed to verify payment: ${msg}` });
  }
});

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
  const ownsBooking =
    sessionHeader && booking.sessionToken && sessionHeader === booking.sessionToken;
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

  if (await isPromoOncePerCustomerViolation(booking.id, booking.promoCode)) {
    res.status(400).json({
      error: "This promo code has already been used on a previous booking with this email",
    });
    return;
  }

  const attendees = await db.select().from(attendeesTable).where(eq(attendeesTable.bookingId, id));
  const lead = attendees.find((a) => a.isLead) || attendees[0];

  if (!lead) {
    res.status(400).json({ error: "No attendee found for booking" });
    return;
  }

  const orderRef = booking.orderReference || `HRAS26-${6541 + id}`;

  try {
    // Delegate the customer-sync + invoice-create + finalize + send to the
    // shared helper so the create and re-issue flows can never drift apart.
    const result = await reissueBookingInvoice(stripe, id);
    if (result.alreadyPaid) {
      const [refreshed] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id));
      res.json({
        invoiceId: refreshed.stripeInvoiceId || `manual-${refreshed.orderReference}`,
        invoiceUrl: refreshed.stripeInvoicePdfUrl || null,
        paymentUrl: refreshed.stripeInvoicePaymentUrl || null,
        invoiceReference: refreshed.orderReference || "",
        alreadyProcessed: true,
      });
      return;
    }

    // Atomic: booking-record updates (currentStep / orderRef / paymentMethod)
    // commit together with the promo counter increment, so a crash between
    // them can never leave the booking finalised without its promo usage
    // recorded (or vice versa).
    await db.transaction(async (tx) => {
      await tx
        .update(bookingsTable)
        .set({
          currentStep: 5,
          orderReference: orderRef,
          paymentMethod: "invoice",
        })
        .where(eq(bookingsTable.id, id));

      if (booking.promoCode) {
        const reserved = await incrementPromoUsage(booking.promoCode, booking.quantity, tx);
        if (!reserved) {
          // The Stripe invoice has already been issued — log but do not throw.
          logger.warn(
            { bookingId: id, promoCode: booking.promoCode, quantity: booking.quantity },
            "Promo cap exceeded after Stripe invoice issued — booking confirmed but usage not incremented",
          );
        }
      }
    });

    try {
      await sendBookingEmails(id);
    } catch (err) {
      logger.error({ err }, "Failed to send booking emails after Stripe invoice");
    }
    try {
      await sendOrganiserNotification(id);
    } catch (err) {
      logger.error({ err }, "Failed to send organiser notification");
    }
    try {
      await syncBookingToSheets(id);
    } catch (err) {
      logger.error({ err }, "Failed to sync to Google Sheets");
    }

    res.json({
      invoiceId: result.invoiceId,
      invoiceUrl: result.pdfUrl,
      paymentUrl: result.paymentUrl,
      invoiceReference: orderRef,
    });
    return;
  } catch (err) {
    const e = err as { raw?: { message?: string }; message?: string };
    const msg = e?.raw?.message || e?.message || "Stripe error";
    logger.error({ err, bookingId: id }, "Failed to create Stripe invoice");
    res.status(502).json({ error: `Failed to create invoice: ${msg}` });
    return;
  }
});

export default router;
