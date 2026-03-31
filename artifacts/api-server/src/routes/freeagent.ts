import { Router, type IRouter } from "express";
import axios from "axios";
import { eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { bookingsTable, attendeesTable, promoCodesTable } from "@workspace/db";
import { sendBookingEmails, sendOrganiserNotification } from "../lib/email";
import { syncBookingToSheets } from "../lib/google-sheets";
import { logger } from "../lib/logger";
import { getFreeAgentToken } from "../lib/freeagent-client";

const router: IRouter = Router();

const FREEAGENT_BASE = "https://api.freeagent.com/v2";

/**
 * Find an existing FreeAgent contact by email, or create a new one.
 * If an existing contact is found, update its company/name so it always
 * reflects the current billing details.
 */
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
      const existingUrl = contacts[0].url;
      // Update the existing contact with the current billing details so the
      // invoice always shows the right company name.
      try {
        await axios.put(
          existingUrl,
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
      } catch (updateErr) {
        logger.warn({ updateErr }, "Could not update existing FreeAgent contact details — continuing with existing data");
      }
      return existingUrl;
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

  const alreadyHasFAInvoice = !!booking.freeagentInvoiceId;
  if (booking.status === "paid" || (booking.status === "invoiced" && alreadyHasFAInvoice)) {
    res.json({
      invoiceId: booking.freeagentInvoiceId || `manual-${booking.orderReference}`,
      invoiceUrl: booking.freeagentInvoiceUrl || null,
      paymentUrl: (booking as any).freeagentPaymentUrl || null,
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
  const orderRef = booking.orderReference || `${prefix}-2026-${num}`;

  // subtotalAmount is net-after-discounts (excl. VAT).
  // Reconstruct pre-discount base for the top line item.
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

    try { await sendBookingEmails(id); } catch (err) { logger.error({ err }, "Failed to send booking emails"); }
    try { await sendOrganiserNotification(id); } catch (err) { logger.error({ err }, "Failed to send organiser notification"); }
    try { await syncBookingToSheets(id); } catch (err) { logger.error({ err }, "Failed to sync to Sheets"); }

    res.json({ invoiceId: `manual-${orderRef}`, invoiceUrl: null, paymentUrl: null, invoiceReference: orderRef });
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
  // Use sales_tax_rate: "20.0" on all lines so FreeAgent calculates VAT correctly.
  // The price fields are NET amounts (excl. VAT) — FreeAgent adds 20% on top automatically.
  // Do NOT add a manual VAT line item — FreeAgent handles it natively.
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
      sales_tax_rate: "20.0",
    },
  ];

  if (groupDiscount > 0) {
    invoiceItems.push({
      description: "Group Discount",
      quantity: "1.0",
      price: (-groupDiscount).toFixed(2),
      item_type: "Products",
      sales_tax_rate: "20.0",
    });
  }

  if (promoDiscount > 0) {
    invoiceItems.push({
      description: `Promo Code: ${booking.promoCode}`,
      quantity: "1.0",
      price: (-promoDiscount).toFixed(2),
      item_type: "Products",
      sales_tax_rate: "20.0",
    });
  }

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
        },
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const invoiceData = invoiceResp.data?.invoice || {};
    const invoiceUrl = (invoiceData.url as string) || null;
    const invoiceId = invoiceUrl?.split("/").pop() || orderRef;
    let paymentUrl: string | null = (invoiceData.payment_url as string) || null;

    // Mark the invoice as Sent via a separate PUT call
    // (FreeAgent ignores status on creation in some configurations)
    if (invoiceUrl) {
      try {
        const sentResp = await axios.put(
          invoiceUrl,
          { invoice: { status: "Sent" } },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        // Re-read payment_url from the updated invoice in case it's only available post-send
        if (!paymentUrl) {
          paymentUrl = (sentResp.data?.invoice?.payment_url as string) || null;
        }
        logger.info({ invoiceId }, "FreeAgent invoice marked as Sent");
      } catch (sentErr) {
        logger.warn({ sentErr }, "Could not mark FreeAgent invoice as Sent — it may remain as Draft");
      }
    }

    await db.update(bookingsTable).set({
      status: "invoiced",
      currentStep: 5,
      orderReference: orderRef,
      paymentMethod: "invoice",
      freeagentInvoiceId: invoiceId,
      freeagentInvoiceUrl: invoiceUrl,
      freeagentPaymentUrl: paymentUrl,
    } as any).where(eq(bookingsTable.id, id));

    if (booking.promoCode) {
      await db.update(promoCodesTable)
        .set({ usedCount: sql`${promoCodesTable.usedCount} + 1` })
        .where(eq(promoCodesTable.code, booking.promoCode));
    }

    try { await sendBookingEmails(id); } catch (err) { logger.error({ err }, "Failed to send booking emails after FreeAgent invoice"); }
    try { await sendOrganiserNotification(id); } catch (err) { logger.error({ err }, "Failed to send organiser notification after FreeAgent invoice"); }
    try { await syncBookingToSheets(id); } catch (err) { logger.error({ err }, "Failed to sync booking to Google Sheets"); }

    res.json({ invoiceId, invoiceUrl, paymentUrl, invoiceReference: orderRef });
  } catch (err) {
    logger.error({ err }, "Failed to create FreeAgent invoice");
    res.status(500).json({ error: "Failed to create invoice in FreeAgent" });
  }
});

export default router;
