import { Router, type IRouter } from "express";
import axios from "axios";
import { eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { bookingsTable, attendeesTable, promoCodesTable, eventSettingsTable } from "@workspace/db";
import { sendBookingEmails, sendOrganiserNotification } from "../lib/email";
import { syncBookingToSheets } from "../lib/google-sheets";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const FREEAGENT_BASE = "https://api.freeagent.com/v2";

interface FreeAgentTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

/**
 * Get a valid FreeAgent access token.
 *
 * Strategy:
 *  1. Check the DB for a cached access token that hasn't expired yet → return it.
 *  2. Otherwise, read the refresh token from the DB (falls back to the env var on
 *     first run).  Exchange it for a new access + refresh token pair.
 *  3. Persist both tokens back to the DB so token rotation is never lost between
 *     server restarts.
 */
async function getFreeAgentToken(): Promise<string | null> {
  const clientId = process.env.FREEAGENT_CLIENT_ID;
  const clientSecret = process.env.FREEAGENT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    logger.warn("FreeAgent client credentials not configured");
    return null;
  }

  // ── 1. Try cached access token ────────────────────────────────────────────
  const [settings] = await db.select().from(eventSettingsTable);
  if (settings?.freeagentAccessToken && settings.freeagentTokenExpiresAt) {
    const expiresAt = new Date(settings.freeagentTokenExpiresAt).getTime();
    // Use cached token if it still has more than 5 minutes left
    if (expiresAt - Date.now() > 5 * 60 * 1000) {
      return settings.freeagentAccessToken;
    }
  }

  // ── 2. Determine which refresh token to use ───────────────────────────────
  const refreshToken =
    settings?.freeagentRefreshToken ||
    process.env.FREEAGENT_REFRESH_TOKEN;

  if (!refreshToken) {
    logger.warn("No FreeAgent refresh token available");
    return null;
  }

  // ── 3. Exchange for a new access token ────────────────────────────────────
  try {
    const response = await axios.post<FreeAgentTokenResponse>(
      "https://api.freeagent.com/v2/token_endpoint",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        auth: { username: clientId, password: clientSecret },
      }
    );

    const { access_token, refresh_token: newRefreshToken, expires_in = 3600 } = response.data;

    // ── 4. Persist both tokens to DB ─────────────────────────────────────────
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    if (settings) {
      await db.update(eventSettingsTable).set({
        freeagentAccessToken: access_token,
        freeagentRefreshToken: newRefreshToken || refreshToken,
        freeagentTokenExpiresAt: expiresAt,
      });
    } else {
      await db.insert(eventSettingsTable).values({
        freeagentAccessToken: access_token,
        freeagentRefreshToken: newRefreshToken || refreshToken,
        freeagentTokenExpiresAt: expiresAt,
      });
    }

    logger.info("FreeAgent access token refreshed and cached in DB");
    return access_token;
  } catch (err) {
    logger.error({ err }, "Failed to get FreeAgent token");
    return null;
  }
}

async function findOrCreateFreeAgentContact(
  token: string,
  email: string,
  firstName: string,
  lastName: string,
  company: string
): Promise<string | null> {
  try {
    const searchResp = await axios.get(`${FREEAGENT_BASE}/contacts`, {
      params: { email },
      headers: { Authorization: `Bearer ${token}` },
    });

    const contacts = (searchResp.data?.contacts as Array<{ url: string }>) || [];
    if (contacts.length > 0) {
      return contacts[0].url;
    }

    const createResp = await axios.post(
      `${FREEAGENT_BASE}/contacts`,
      {
        contact: {
          first_name: firstName,
          last_name: lastName,
          organisation_name: company,
          email,
        },
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    return (createResp.data?.contact?.url as string) || null;
  } catch (err) {
    logger.error({ err }, "Failed to find/create FreeAgent contact");
    return null;
  }
}

router.post("/freeagent/create-invoice", async (req, res): Promise<void> => {
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

  // Idempotency guard: if booking is already fully invoiced with a real FreeAgent invoice,
  // or is paid, return the existing data without creating a duplicate.
  // Exception: if booking was marked "invoiced" but has no FA invoice ID, allow retry.
  const alreadyHasFAInvoice = !!booking.freeagentInvoiceId;
  if (booking.status === "paid" || (booking.status === "invoiced" && alreadyHasFAInvoice)) {
    res.json({
      invoiceId: booking.freeagentInvoiceId || `manual-${booking.orderReference}`,
      invoiceUrl: booking.freeagentInvoiceUrl || null,
      invoiceReference: booking.orderReference || "",
      alreadyProcessed: true,
    });
    return;
  }

  const attendees = await db
    .select()
    .from(attendeesTable)
    .where(eq(attendeesTable.bookingId, id));

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

  const prefix = "HRS";
  const num = Math.floor(10000 + Math.random() * 90000);
  // Reuse existing order reference if this booking already has one (retry scenario)
  const orderRef = booking.orderReference || `${prefix}-2026-${num}`;

  // booking.subtotalAmount is subtotalAfterDiscounts (post-discount).
  // Reconstruct the pre-discount base so we can show accurate line-item breakdown.
  const subtotalAfterDiscounts = parseFloat(booking.subtotalAmount?.toString() || "0");
  const vat = parseFloat(booking.vatAmount?.toString() || "0");
  const groupDiscount = parseFloat(booking.groupDiscountAmount?.toString() || "0");
  const promoDiscount = parseFloat(booking.promoDiscountAmount?.toString() || "0");
  const baseAmount = subtotalAfterDiscounts + groupDiscount + promoDiscount;

  const token = await getFreeAgentToken();

  if (!token) {
    logger.warn("FreeAgent not configured — creating booking record without invoice");

    await db.update(bookingsTable).set({
      status: "invoiced",
      currentStep: 5,
      orderReference: orderRef,
      paymentMethod: "invoice",
    }).where(eq(bookingsTable.id, id));

    if (booking.promoCode) {
      await db.update(promoCodesTable)
        .set({ usedCount: sql`${promoCodesTable.usedCount} + 1` })
        .where(eq(promoCodesTable.code, booking.promoCode));
    }

    try {
      await sendBookingEmails(id);
    } catch (err) {
      logger.error({ err }, "Failed to send booking emails after invoice");
    }

    try {
      await sendOrganiserNotification(id);
    } catch (err) {
      logger.error({ err }, "Failed to send organiser notification after invoice");
    }

    try {
      await syncBookingToSheets(id);
    } catch (err) {
      logger.error({ err }, "Failed to sync booking to Google Sheets");
    }

    res.json({
      invoiceId: `manual-${orderRef}`,
      invoiceUrl: null,
      invoiceReference: orderRef,
    });
    return;
  }

  const contactEmail = booking.billingEmail || lead.workEmail;
  const contactFirstName = booking.billingName?.split(" ")[0] || lead.firstName;
  const contactLastName = booking.billingName?.split(" ").slice(1).join(" ") || lead.lastName;
  const contactCompany = booking.billingCompany || lead.company;

  const contactUrl = await findOrCreateFreeAgentContact(
    token,
    contactEmail,
    contactFirstName,
    contactLastName,
    contactCompany
  );

  if (!contactUrl) {
    res.status(500).json({ error: "Failed to create FreeAgent contact" });
    return;
  }

  // Build invoice line items.
  // Main line = pre-discount pass price so the invoice clearly shows the gross amount.
  // Discount lines reduce it to the agreed subtotal.
  // VAT is calculated on subtotalAfterDiscounts and shown as a separate line.
  const invoiceItems: Array<{
    description: string;
    quantity: string;
    price: string;
    item_type: string;
    sales_tax_rate: string;
  }> = [
    {
      description: `${passLabels[booking.passType] || booking.passType} × ${booking.quantity}`,
      quantity: "1.0",
      price: baseAmount.toFixed(2),
      item_type: "Products",
      sales_tax_rate: "0.0",
    },
  ];

  if (groupDiscount > 0) {
    invoiceItems.push({
      description: "Group Discount",
      quantity: "1.0",
      price: (-groupDiscount).toFixed(2),
      item_type: "Products",
      sales_tax_rate: "0.0",
    });
  }

  if (promoDiscount > 0) {
    invoiceItems.push({
      description: `Promo Code: ${booking.promoCode}`,
      quantity: "1.0",
      price: (-promoDiscount).toFixed(2),
      item_type: "Products",
      sales_tax_rate: "0.0",
    });
  }

  invoiceItems.push({
    description: "VAT (20%)",
    quantity: "1.0",
    price: vat.toFixed(2),
    item_type: "Products",
    sales_tax_rate: "0.0",
  });

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 14);

  try {
    const invoiceResp = await axios.post(
      `${FREEAGENT_BASE}/invoices`,
      {
        invoice: {
          contact: contactUrl,
          dated_on: new Date().toISOString().split("T")[0],
          due_on: dueDate.toISOString().split("T")[0],
          payment_terms_in_days: 14,
          reference: orderRef,
          invoice_items: invoiceItems,
          status: "Sent",
        },
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const invoiceUrl = (invoiceResp.data?.invoice?.url as string) || null;
    const invoiceId = invoiceUrl?.split("/").pop() || orderRef;

    await db.update(bookingsTable).set({
      status: "invoiced",
      currentStep: 5,
      orderReference: orderRef,
      paymentMethod: "invoice",
      freeagentInvoiceId: invoiceId,
      freeagentInvoiceUrl: invoiceUrl,
    }).where(eq(bookingsTable.id, id));

    if (booking.promoCode) {
      await db.update(promoCodesTable)
        .set({ usedCount: sql`${promoCodesTable.usedCount} + 1` })
        .where(eq(promoCodesTable.code, booking.promoCode));
    }

    try {
      await sendBookingEmails(id);
    } catch (err) {
      logger.error({ err }, "Failed to send booking emails after FreeAgent invoice");
    }

    try {
      await sendOrganiserNotification(id);
    } catch (err) {
      logger.error({ err }, "Failed to send organiser notification after FreeAgent invoice");
    }

    try {
      await syncBookingToSheets(id);
    } catch (err) {
      logger.error({ err }, "Failed to sync booking to Google Sheets");
    }

    res.json({ invoiceId, invoiceUrl, invoiceReference: orderRef });
  } catch (err) {
    logger.error({ err }, "Failed to create FreeAgent invoice");
    res.status(500).json({ error: "Failed to create invoice in FreeAgent" });
  }
});

export default router;
