import nodemailer from "nodemailer";
import { logger } from "./logger";
import { db } from "@workspace/db";
import { emailLogsTable, emailTemplatesTable, bookingsTable, attendeesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generatePdfReceipt } from "./pdf";

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = parseInt(process.env.SMTP_PORT || "587");

  if (!host || !user || !pass) {
    logger.warn("SMTP credentials not configured — emails will be logged but not sent");
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

const FROM_EMAIL = process.env.FROM_EMAIL || "noreply@hranalyticssummit.com";
const FROM_NAME = process.env.FROM_NAME || "HR Analytics Summit";

async function logEmail(
  bookingId: number | null,
  recipient: string,
  type: "confirmation" | "receipt" | "welcome" | "invoice" | "test",
  status: "sent" | "failed" | "pending",
  errorMessage?: string
) {
  try {
    await db.insert(emailLogsTable).values({
      bookingId,
      recipient,
      type,
      status,
      errorMessage: errorMessage || null,
    });
  } catch (err) {
    logger.error({ err }, "Failed to log email");
  }
}

async function sendMail(options: {
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}): Promise<boolean> {
  const transporter = createTransporter();
  if (!transporter) {
    logger.info({ to: options.to, subject: options.subject }, "Email not sent — SMTP not configured");
    return false;
  }

  try {
    await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      attachments: options.attachments,
    });
    return true;
  } catch (err) {
    logger.error({ err, to: options.to }, "Failed to send email");
    return false;
  }
}

export function wrapInBrandedLayout(content: string, title = "HR Analytics Summit"): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { font-family: 'Figtree', Arial, sans-serif; background: #FCFBFA; margin: 0; padding: 0; color: #000; }
    .wrapper { max-width: 600px; margin: 0 auto; background: #fff; }
    .header { background: #FCFBFA; padding: 24px 32px; border-bottom: 2px solid #E74F3E; text-align: center; }
    .header img { height: 48px; }
    .content { padding: 32px; }
    .footer { background: #1a1a1a; color: #ccc; padding: 24px 32px; text-align: center; font-size: 13px; }
    .footer a { color: #F48847; text-decoration: none; }
    h1, h2, h3 { color: #000; }
    .badge { display: inline-block; background: #F7E25E; color: #221D1B; padding: 4px 12px; border-radius: 100px; font-size: 12px; font-weight: 600; }
    .cta-btn { display: inline-block; background: #E74F3E; color: #fff; padding: 12px 28px; border-radius: 300px; text-decoration: none; font-weight: 600; margin: 16px 0; }
    .price-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
    .price-total { display: flex; justify-content: space-between; padding: 12px 0; font-weight: 700; font-size: 18px; }
    .info-box { background: #FCFBFA; border: 1px solid #DEDDDC; padding: 16px 20px; border-radius: 4px; margin: 16px 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <strong style="font-size: 20px; color: #E74F3E;">HR Analytics Summit</strong>
      <div style="font-size: 13px; color: #666; margin-top: 4px;">3 September 2026 · 155 Bishopsgate, London</div>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <p>&copy; 2026 HR Analytics Summit. All rights reserved.</p>
      <p><a href="https://www.hranalyticssummit.com">www.hranalyticssummit.com</a></p>
      <p style="font-size: 11px; color: #999;">People Strategy Hub Ltd · London, UK</p>
    </div>
  </div>
</body>
</html>`;
}

export async function sendBookingEmails(bookingId: number): Promise<void> {
  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, bookingId));

  if (!booking) {
    logger.warn({ bookingId }, "Booking not found for email sending");
    return;
  }

  const attendees = await db
    .select()
    .from(attendeesTable)
    .where(eq(attendeesTable.bookingId, bookingId));

  const lead = attendees.find((a) => a.isLead) || attendees[0];
  if (!lead) {
    logger.warn({ bookingId }, "No lead attendee found for email sending");
    return;
  }

  const passLabels: Record<string, string> = {
    single: "Single Pass",
    team: "Team Pass (3 seats)",
    business: "Business Pass",
  };
  const passLabel = passLabels[booking.passType] || booking.passType;

  const subtotal = parseFloat(booking.subtotalAmount?.toString() || "0");
  const vat = parseFloat(booking.vatAmount?.toString() || "0");
  const total = parseFloat(booking.totalAmount?.toString() || "0");
  const promoDiscount = parseFloat(booking.promoDiscountAmount?.toString() || "0");
  const groupDiscount = parseFloat(booking.groupDiscountAmount?.toString() || "0");

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

  const attendeeRows = attendees
    .map(
      (a) => `
    <tr>
      <td style="padding: 8px 4px; border-bottom: 1px solid #eee;">${a.isLead ? "✓ Lead" : ""}</td>
      <td style="padding: 8px 4px; border-bottom: 1px solid #eee;">${a.firstName} ${a.lastName}</td>
      <td style="padding: 8px 4px; border-bottom: 1px solid #eee;">${a.jobTitle}</td>
      <td style="padding: 8px 4px; border-bottom: 1px solid #eee;">${a.company}</td>
      <td style="padding: 8px 4px; border-bottom: 1px solid #eee;">${a.workEmail}</td>
    </tr>`
    )
    .join("");

  const confirmationHtml = wrapInBrandedLayout(`
    <h2>Booking Confirmed!</h2>
    <p>Dear ${lead.firstName},</p>
    <p>Thank you for registering for the <strong>HR Analytics Summit 2026</strong>. Your booking is confirmed.</p>

    <div class="info-box">
      <strong>Order Reference:</strong> ${booking.orderReference || `#${bookingId}`}<br>
      <strong>Pass Type:</strong> ${passLabel}<br>
      <strong>Quantity:</strong> ${booking.quantity} ${booking.quantity === 1 ? "pass" : "passes"}
    </div>

    <h3>Registered Attendees</h3>
    <table width="100%" cellspacing="0" cellpadding="0" style="font-size: 14px;">
      <thead>
        <tr style="background: #f5f5f5;">
          <th style="padding: 8px 4px; text-align: left;">Lead</th>
          <th style="padding: 8px 4px; text-align: left;">Name</th>
          <th style="padding: 8px 4px; text-align: left;">Job Title</th>
          <th style="padding: 8px 4px; text-align: left;">Company</th>
          <th style="padding: 8px 4px; text-align: left;">Email</th>
        </tr>
      </thead>
      <tbody>${attendeeRows}</tbody>
    </table>

    <h3>Price Summary</h3>
    <div class="price-row"><span>Subtotal (excl. VAT)</span><span>${formatCurrency(subtotal)}</span></div>
    ${groupDiscount > 0 ? `<div class="price-row"><span>Group Discount</span><span>-${formatCurrency(groupDiscount)}</span></div>` : ""}
    ${promoDiscount > 0 ? `<div class="price-row"><span>Promo Code (${booking.promoCode})</span><span>-${formatCurrency(promoDiscount)}</span></div>` : ""}
    <div class="price-row"><span>VAT (20%)</span><span>${formatCurrency(vat)}</span></div>
    <div class="price-total"><span>Total</span><span>${formatCurrency(total)}</span></div>

    <div class="info-box" style="margin-top: 24px;">
      <strong>Event Details</strong><br>
      <strong>Date:</strong> 3 September 2026<br>
      <strong>Venue:</strong> 155 Bishopsgate, London, EC2M 3TQ
    </div>

    <p>A PDF VAT receipt is attached to this email for your records.</p>
    <p>We look forward to seeing you at the HR Analytics Summit!</p>
  `);

  let pdfBuffer: Buffer | null = null;
  try {
    pdfBuffer = await generatePdfReceipt(booking, attendees);
  } catch (err) {
    logger.error({ err }, "Failed to generate PDF receipt");
  }

  const attachments = pdfBuffer
    ? [
        {
          filename: `receipt-${booking.orderReference || bookingId}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ]
    : [];

  const confirmSent = await sendMail({
    to: lead.workEmail,
    subject: `Booking Confirmed — HR Analytics Summit 2026 (${booking.orderReference || `#${bookingId}`})`,
    html: confirmationHtml,
    attachments,
  });

  await logEmail(
    bookingId,
    lead.workEmail,
    "confirmation",
    confirmSent ? "sent" : "failed",
    confirmSent ? undefined : "SMTP not configured or send failed"
  );

  if (pdfBuffer) {
    await logEmail(bookingId, lead.workEmail, "receipt", confirmSent ? "sent" : "failed");
  }

  await sendWelcomeEmail(bookingId, lead.firstName, lead.workEmail);
}

export async function sendWelcomeEmail(
  bookingId: number | null,
  firstName: string,
  toEmail: string
): Promise<void> {
  try {
    const [template] = await db
      .select()
      .from(emailTemplatesTable)
      .where(eq(emailTemplatesTable.type, "welcome"));

    if (!template) {
      logger.warn("No welcome email template found");
      return;
    }

    const personalised = template.htmlBody
      .replace(/\{\{firstName\}\}/g, firstName)
      .replace(/\{\{name\}\}/g, firstName);

    const html = wrapInBrandedLayout(personalised);

    const sent = await sendMail({
      to: toEmail,
      subject: template.subject,
      html,
    });

    await logEmail(
      bookingId,
      toEmail,
      "welcome",
      sent ? "sent" : "failed",
      sent ? undefined : "SMTP not configured or send failed"
    );
  } catch (err) {
    logger.error({ err }, "Failed to send welcome email");
  }
}
