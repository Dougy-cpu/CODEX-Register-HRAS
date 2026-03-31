import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { emailTemplatesTable, emailLogsTable } from "@workspace/db";
import { sendWelcomeEmail, wrapInBrandedLayout } from "../lib/email";
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

router.get("/email-templates/welcome", async (_req, res): Promise<void> => {
  const [template] = await db
    .select()
    .from(emailTemplatesTable)
    .where(eq(emailTemplatesTable.type, "welcome"));

  if (!template) {
    res.status(404).json({ error: "Welcome email template not found" });
    return;
  }

  res.json(formatTemplate(template));
});

router.put("/email-templates/welcome", adminAuth, async (req, res): Promise<void> => {
  const { subject, htmlBody } = req.body;

  if (!subject || !htmlBody) {
    res.status(400).json({ error: "subject and htmlBody are required" });
    return;
  }

  const existing = await db
    .select()
    .from(emailTemplatesTable)
    .where(eq(emailTemplatesTable.type, "welcome"));

  let updated;
  if (existing.length > 0) {
    [updated] = await db
      .update(emailTemplatesTable)
      .set({ subject, htmlBody })
      .where(eq(emailTemplatesTable.type, "welcome"))
      .returning();
  } else {
    [updated] = await db
      .insert(emailTemplatesTable)
      .values({ type: "welcome", subject, htmlBody })
      .returning();
  }

  res.json(formatTemplate(updated));
});

router.post("/email-templates/welcome/test-send", adminAuth, async (req, res): Promise<void> => {
  const { toEmail, toName } = req.body;

  if (!toEmail) {
    res.status(400).json({ error: "toEmail is required" });
    return;
  }

  await sendWelcomeEmail(null, toName || "Test User", toEmail);

  res.json({ success: true, message: `Test email sent to ${toEmail}` });
});

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

  const { sendBookingEmails } = await import("../lib/email");
  await sendBookingEmails(bookingId);

  res.json({ success: true, message: "Emails resent successfully" });
});

export default router;
