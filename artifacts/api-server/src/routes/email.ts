import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { emailTemplatesTable, emailLogsTable, eventSettingsTable } from "@workspace/db";
import { sendWelcomeEmail, wrapInBrandedLayout, getEventSettings } from "../lib/email";
import { adminAuth } from "../middleware/admin-auth";

const router: IRouter = Router();

function formatTemplate(t: typeof emailTemplatesTable.$inferSelect) {
  return {
    ...t,
    updatedAt: t.updatedAt.toISOString(),
  };
}

function formatLog(l: typeof emailLogsTable.$inferSelect) {
  return {
    ...l,
    sentAt: l.sentAt.toISOString(),
  };
}

// ─── Event Settings ───────────────────────────────────────────────────────────

router.get("/admin/event-settings", adminAuth, async (_req, res): Promise<void> => {
  const settings = await getEventSettings();
  res.json({
    ...settings,
    updatedAt: settings.updatedAt.toISOString(),
  });
});

router.put("/admin/event-settings", adminAuth, async (req, res): Promise<void> => {
  const {
    eventName, eventDate, eventVenue, eventVenuePostcode,
    orgName, orgAddress, orgWebsite, logoDataUrl,
    fromName, fromEmail,
  } = req.body;

  const existing = await db.select().from(eventSettingsTable);

  let updated;
  if (existing.length > 0) {
    ([updated] = await db
      .update(eventSettingsTable)
      .set({
        ...(eventName !== undefined && { eventName }),
        ...(eventDate !== undefined && { eventDate }),
        ...(eventVenue !== undefined && { eventVenue }),
        ...(eventVenuePostcode !== undefined && { eventVenuePostcode }),
        ...(orgName !== undefined && { orgName }),
        ...(orgAddress !== undefined && { orgAddress }),
        ...(orgWebsite !== undefined && { orgWebsite }),
        ...(logoDataUrl !== undefined && { logoDataUrl }),
        ...(fromName !== undefined && { fromName }),
        ...(fromEmail !== undefined && { fromEmail }),
      })
      .where(eq(eventSettingsTable.id, existing[0].id))
      .returning());
  } else {
    ([updated] = await db
      .insert(eventSettingsTable)
      .values({
        eventName: eventName || "HR Analytics Summit",
        eventDate: eventDate || "3 September 2026",
        eventVenue: eventVenue || "155 Bishopsgate, London",
        eventVenuePostcode: eventVenuePostcode || "EC2M 3TQ",
        orgName: orgName || "People Strategy Hub Ltd",
        orgAddress: orgAddress || "London, UK",
        orgWebsite: orgWebsite || "https://www.hranalyticssummit.com",
        logoDataUrl: logoDataUrl || null,
        fromName: fromName || "HR Analytics Summit",
        fromEmail: fromEmail || "noreply@hranalyticssummit.com",
      })
      .returning());
  }

  res.json({
    ...updated,
    updatedAt: updated.updatedAt.toISOString(),
  });
});

// ─── Generic Template Routes ──────────────────────────────────────────────────

router.get("/email-templates/:type", async (req, res): Promise<void> => {
  const type = req.params.type as "welcome" | "confirmation" | "invoice_reminder";
  if (!["welcome", "confirmation", "invoice_reminder"].includes(type)) {
    res.status(400).json({ error: "Invalid template type" });
    return;
  }

  let [template] = await db
    .select()
    .from(emailTemplatesTable)
    .where(eq(emailTemplatesTable.type, type));

  if (!template) {
    const defaults: Record<string, { subject: string; htmlBody: string }> = {
      welcome: {
        subject: "Welcome to HR Analytics Summit 2026!",
        htmlBody: "<h2>Welcome, {{firstName}}!</h2><p>We're thrilled to have you join us at the HR Analytics Summit 2026. Your booking is confirmed and we can't wait to see you there.</p><p>If you have any questions in the meantime, don't hesitate to reach out.</p><p>See you on 3 September!</p>",
      },
      confirmation: {
        subject: "Booking Confirmed — HR Analytics Summit 2026",
        htmlBody: "<h2>Booking Confirmed, {{firstName}}!</h2><p>Thank you for registering. Your order reference is <strong>{{orderReference}}</strong>.</p><p>You have booked <strong>{{quantity}}</strong> {{passType}} pass(es). A full VAT receipt is attached to this email.</p><p>We look forward to seeing you at the HR Analytics Summit!</p>",
      },
      invoice_reminder: {
        subject: "Invoice Reminder — {{orderReference}} — HR Analytics Summit 2026",
        htmlBody: "<p>Dear {{recipientName}},</p><p>This is a friendly reminder that invoice <strong>{{orderReference}}</strong> for your registration to the <strong>HR Analytics Summit 2026</strong> is due on <strong>{{dueDate}}</strong>.</p><p>Please arrange payment at your earliest convenience using the bank transfer details below. A copy of the invoice PDF is attached for your reference.</p>{{payOnlineButton}}<p>If you have already arranged payment, please disregard this email. For any queries, please contact <a href=\"mailto:douglas@dynamicbusinessleaders.co.uk\">douglas@dynamicbusinessleaders.co.uk</a>.</p>",
      },
    };
    const def = defaults[type];
    if (!def) {
      res.status(404).json({ error: `${type} email template not found` });
      return;
    }
    [template] = await db
      .insert(emailTemplatesTable)
      .values({ type, subject: def.subject, htmlBody: def.htmlBody })
      .returning();
  }

  res.json(formatTemplate(template));
});

router.put("/email-templates/:type", adminAuth, async (req, res): Promise<void> => {
  const type = req.params.type as "welcome" | "confirmation" | "invoice_reminder";
  if (!["welcome", "confirmation", "invoice_reminder"].includes(type)) {
    res.status(400).json({ error: "Invalid template type" });
    return;
  }

  const { subject, htmlBody } = req.body;

  if (!subject || !htmlBody) {
    res.status(400).json({ error: "subject and htmlBody are required" });
    return;
  }

  const existing = await db
    .select()
    .from(emailTemplatesTable)
    .where(eq(emailTemplatesTable.type, type));

  let updated;
  if (existing.length > 0) {
    ([updated] = await db
      .update(emailTemplatesTable)
      .set({ subject, htmlBody })
      .where(eq(emailTemplatesTable.type, type))
      .returning());
  } else {
    ([updated] = await db
      .insert(emailTemplatesTable)
      .values({ type, subject, htmlBody })
      .returning());
  }

  res.json(formatTemplate(updated));
});

router.post("/email-templates/:type/test-send", adminAuth, async (req, res): Promise<void> => {
  const type = req.params.type as "welcome" | "confirmation" | "invoice_reminder";
  const { toEmail, toName } = req.body;

  if (!toEmail) {
    res.status(400).json({ error: "toEmail is required" });
    return;
  }

  if (type === "welcome") {
    await sendWelcomeEmail(null, toName || "Test User", toEmail);
  } else {
    // For other types, fetch template and send preview
    const [template] = await db
      .select()
      .from(emailTemplatesTable)
      .where(eq(emailTemplatesTable.type, type));

    if (!template) {
      res.status(404).json({ error: `No ${type} template found` });
      return;
    }

    const settings = await getEventSettings();
    const { sendMail, wrapInBrandedLayout: wrap } = await import("../lib/email");

    const testVars: Record<string, string> = type === "invoice_reminder" ? {
      "{{firstName}}": toName?.split(" ")[0] || "Test",
      "{{recipientName}}": toName || "Test User",
      "{{orderReference}}": "HRAS26-TEST-001",
      "{{dueDate}}": "30 April 2026",
      "{{payOnlineButton}}": `<p style="margin:24px 0;text-align:center;"><a href="#" style="display:inline-block;background:#E74F3E;color:#fff;padding:14px 32px;text-decoration:none;font-weight:bold;font-size:15px;border-radius:4px;">Pay Invoice Online →</a></p>`,
      "{{payOnlineUrl}}": "#",
    } : {
      "{{firstName}}": toName || "Test User",
      "{{name}}": toName || "Test User",
      "{{orderReference}}": "HRAS26-TEST-001",
      "{{passType}}": "Single Pass",
      "{{quantity}}": "1",
      "{{total}}": "£238.80",
    };

    let personalised = template.htmlBody;
    for (const [key, val] of Object.entries(testVars)) {
      personalised = personalised.replaceAll(key, val);
    }

    const subjectVars: Record<string, string> = {
      "{{orderReference}}": "HRAS26-TEST-001",
      "{{recipientName}}": toName || "Test User",
      "{{firstName}}": toName?.split(" ")[0] || "Test",
    };
    let subject = template.subject;
    for (const [key, val] of Object.entries(subjectVars)) {
      subject = subject.replaceAll(key, val);
    }

    const html = wrap(personalised, settings);
    await sendMail({
      to: toEmail,
      subject: `[TEST] ${subject}`,
      html,
      fromName: settings.fromName,
      fromEmail: settings.fromEmail,
    });
  }

  res.json({ success: true, message: `Test email sent to ${toEmail}` });
});

// ─── Email Logs ───────────────────────────────────────────────────────────────

router.get("/admin/email-logs", adminAuth, async (req, res): Promise<void> => {
  const page = parseInt(req.query.page as string || "1", 10);
  const limit = parseInt(req.query.limit as string || "50", 10);
  const offset = (page - 1) * limit;

  const allLogs = await db
    .select()
    .from(emailLogsTable)
    .orderBy(desc(emailLogsTable.sentAt))
    .limit(limit)
    .offset(offset);

  const total = await db.select().from(emailLogsTable);

  res.json({
    logs: allLogs.map(formatLog),
    total: total.length,
    page,
    limit,
  });
});

router.post("/admin/email-logs/:bookingId/resend", adminAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.bookingId) ? req.params.bookingId[0] : req.params.bookingId;
  const bookingId = parseInt(raw, 10);

  const { resendConfirmationAndReceipt } = await import("../lib/email");
  await resendConfirmationAndReceipt(bookingId);

  res.json({ success: true, message: "Confirmation and PDF receipt resent successfully" });
});

router.post("/admin/bookings/:bookingId/send-invoice-reminder", adminAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.bookingId) ? req.params.bookingId[0] : req.params.bookingId;
  const bookingId = parseInt(raw, 10);
  if (isNaN(bookingId)) {
    res.status(400).json({ error: "Invalid booking ID" });
    return;
  }
  try {
    const { sendInvoiceReminder } = await import("../lib/email");
    await sendInvoiceReminder(bookingId);
    res.json({ success: true, message: "Invoice reminder sent successfully" });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to send invoice reminder" });
  }
});

// Debug: download the receipt PDF directly for a booking (to verify it's valid)
router.get("/admin/email-logs/:bookingId/receipt-pdf", adminAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.bookingId) ? req.params.bookingId[0] : req.params.bookingId;
  const bookingId = parseInt(raw, 10);

  try {
    const { db } = await import("@workspace/db");
    const { bookingsTable, attendeesTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { generatePdfReceipt } = await import("../lib/pdf");

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
    if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

    const attendees = await db.select().from(attendeesTable).where(eq(attendeesTable.bookingId, bookingId));
    const pdfBuffer = await generatePdfReceipt(booking, attendees);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="receipt-${booking.orderReference || bookingId}.pdf"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
