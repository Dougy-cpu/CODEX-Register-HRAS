import https from "https";
import nodemailer from "nodemailer";
import { logger } from "./logger";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "@workspace/db";
import { emailLogsTable, emailTemplatesTable, bookingsTable, attendeesTable, notificationEmailsTable, eventSettingsTable } from "@workspace/db";
import type { EventSettings } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generatePdfReceipt } from "./pdf";
import { getFreeAgentToken, downloadFreeAgentInvoicePdf } from "./freeagent-client";

async function downloadHttpsPdf(url: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) { resolve(null); return; }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", () => resolve(null));
    }).on("error", () => resolve(null));
  });
}

// Company info PDF attachment (attached to every confirmation email)
let _companyInfoPdf: Buffer | null | undefined = undefined;
function getCompanyInfoPdf(): Buffer | null {
  if (_companyInfoPdf !== undefined) return _companyInfoPdf;
  try {
    const _dir = dirname(fileURLToPath(import.meta.url));
    const assetPath = join(_dir, "assets", "company-info.pdf");
    if (existsSync(assetPath)) {
      _companyInfoPdf = readFileSync(assetPath);
      logger.info({ sizeBytes: _companyInfoPdf.length }, "Company info PDF loaded for email attachments");
    } else {
      logger.warn({ assetPath }, "Company info PDF not found — will not be attached to emails");
      _companyInfoPdf = null;
    }
  } catch (err) {
    logger.warn({ err }, "Failed to load company info PDF");
    _companyInfoPdf = null;
  }
  return _companyInfoPdf;
}

const defaultSettings: Omit<EventSettings, "id" | "updatedAt"> = {
  eventName: "HR Analytics Summit",
  eventDate: "3 September 2026",
  eventVenue: "155 Bishopsgate, London",
  eventVenuePostcode: "EC2M 3TQ",
  orgName: "People Strategy Hub Ltd",
  orgAddress: "London, UK",
  orgWebsite: "https://www.hranalyticssummit.com",
  logoDataUrl: null,
  fromName: "HR Analytics Summit",
  fromEmail: "noreply@hranalyticssummit.com",
  freeagentRefreshToken: null,
  freeagentAccessToken: null,
  freeagentTokenExpiresAt: null,
};

export async function getEventSettings(): Promise<EventSettings> {
  const [settings] = await db.select().from(eventSettingsTable);
  if (settings) return settings;
  // Seed defaults if not present
  const [inserted] = await db.insert(eventSettingsTable).values(defaultSettings).returning();
  return inserted;
}

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

export async function sendMail(options: {
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
  fromName?: string;
  fromEmail?: string;
}): Promise<boolean> {
  const transporter = createTransporter();
  if (!transporter) {
    logger.info({ to: options.to, subject: options.subject }, "Email not sent — SMTP not configured");
    return false;
  }

  const fromName = options.fromName || FROM_NAME;
  const fromEmail = options.fromEmail || FROM_EMAIL;

  try {
    const nodemailerAttachments = (options.attachments || []).map((a) => ({
      filename: a.filename,
      content: a.content.toString("base64"),
      encoding: "base64",
      contentType: a.contentType,
      contentDisposition: "attachment" as const,
    }));
    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      attachments: nodemailerAttachments,
    });
    return true;
  } catch (err) {
    logger.error({ err, to: options.to }, "Failed to send email");
    return false;
  }
}

type BrandingSettings = {
  eventName?: string;
  eventDate?: string;
  eventVenue?: string;
  orgName?: string;
  orgAddress?: string;
  orgWebsite?: string;
  logoDataUrl?: string | null;
};

export function wrapInBrandedLayout(content: string, settingsOrTitle?: BrandingSettings | string): string {
  const settings: BrandingSettings = (typeof settingsOrTitle === "object" && settingsOrTitle !== null)
    ? settingsOrTitle
    : {};

  const eventName = settings.eventName || "HR Analytics Summit";
  const eventDate = settings.eventDate || "3 September 2026";
  const eventVenue = settings.eventVenue || "155 Bishopsgate, London";
  const orgName = settings.orgName || "People Strategy Hub Ltd";
  const orgAddress = settings.orgAddress || "London, UK";
  const orgWebsite = settings.orgWebsite || "https://www.hranalyticssummit.com";
  const logoDataUrl = settings.logoDataUrl;

  const headerContent = logoDataUrl
    ? `<img src="${logoDataUrl}" alt="${eventName}" style="max-height:60px;max-width:200px;" />`
    : `<strong style="font-size: 20px; color: #E74F3E;">${eventName}</strong>`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${eventName}</title>
  <style>
    body { font-family: 'Figtree', Arial, sans-serif; background: #FCFBFA; margin: 0; padding: 0; color: #000; }
    .wrapper { max-width: 600px; margin: 0 auto; background: #fff; }
    .header { background: #FCFBFA; padding: 24px 32px; border-bottom: 2px solid #E74F3E; text-align: center; }
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
      ${headerContent}
      <div style="font-size: 13px; color: #666; margin-top: 4px;">${eventDate} · ${eventVenue}</div>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <p>&copy; 2026 ${eventName}. All rights reserved.</p>
      <p><a href="${orgWebsite}">${orgWebsite.replace(/^https?:\/\//, "")}</a></p>
      <p style="font-size: 11px; color: #999;">${orgName} · ${orgAddress}</p>
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

  const settings = await getEventSettings();

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
      <strong>Date:</strong> ${settings.eventDate}<br>
      <strong>Venue:</strong> ${settings.eventVenue}, ${settings.eventVenuePostcode}
    </div>

    <p>A PDF VAT receipt is attached to this email for your records.</p>
    ${booking.stripeInvoicePaymentUrl || booking.freeagentPaymentUrl ? `<p style="margin-top:16px;"><a href="${booking.stripeInvoicePaymentUrl || booking.freeagentPaymentUrl}" style="display:inline-block;background:#E74F3E;color:#fff;padding:12px 28px;text-decoration:none;font-weight:bold;font-size:15px;">Download Invoice/Pay Online →</a></p>` : ""}
    <p>We look forward to seeing you at the ${settings.eventName}!</p>
  `, settings);

  // Prefer Stripe invoice PDF, then FreeAgent PDF, then our custom receipt
  let pdfBuffer: Buffer | null = null;
  let pdfFilename = `receipt-${booking.orderReference || bookingId}.pdf`;
  const stripeInvoicePdfUrl = booking.stripeInvoicePdfUrl;
  if (stripeInvoicePdfUrl) {
    try {
      pdfBuffer = await downloadHttpsPdf(stripeInvoicePdfUrl);
      if (pdfBuffer) {
        pdfFilename = `invoice-${booking.orderReference || bookingId}.pdf`;
        logger.info({ bookingId, sizeBytes: pdfBuffer.length }, "Using Stripe invoice PDF for email attachment");
      } else {
        logger.warn({ bookingId }, "Stripe PDF not available — falling back");
      }
    } catch (err) {
      logger.warn({ err }, "Could not download Stripe PDF — falling back");
    }
  }
  if (!pdfBuffer) {
    const faInvoiceUrl = booking.freeagentInvoiceUrl;
    if (faInvoiceUrl) {
      try {
        const faToken = await getFreeAgentToken();
        if (faToken) {
          pdfBuffer = await downloadFreeAgentInvoicePdf(faInvoiceUrl, faToken);
          if (pdfBuffer) {
            pdfFilename = `invoice-${booking.orderReference || bookingId}.pdf`;
            logger.info({ bookingId, sizeBytes: pdfBuffer.length }, "Using FreeAgent invoice PDF for email attachment");
          }
        }
      } catch (err) {
        logger.warn({ err }, "Could not download FreeAgent PDF — falling back to custom receipt");
      }
    }
  }
  if (!pdfBuffer) {
    try {
      pdfBuffer = await generatePdfReceipt(booking, attendees);
      if (pdfBuffer) logger.info({ bookingId, sizeBytes: pdfBuffer.length }, "Using custom PDF receipt for email attachment");
    } catch (err) {
      logger.error({ err }, "Failed to generate PDF receipt");
    }
  }

  const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
  if (pdfBuffer) {
    attachments.push({ filename: pdfFilename, content: pdfBuffer, contentType: "application/pdf" });
  }
  const companyInfoPdf = getCompanyInfoPdf();
  if (companyInfoPdf) {
    attachments.push({ filename: "DBL-company-information.pdf", content: companyInfoPdf, contentType: "application/pdf" });
  }

  const confirmSent = await sendMail({
    to: lead.workEmail,
    subject: `Booking Confirmed — ${settings.eventName} (${booking.orderReference || `#${bookingId}`})`,
    html: confirmationHtml,
    attachments,
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
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

export async function resendConfirmationAndReceipt(bookingId: number): Promise<void> {
  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, bookingId));

  if (!booking) {
    logger.warn({ bookingId }, "Booking not found for email resend");
    return;
  }

  const settings = await getEventSettings();

  const attendees = await db
    .select()
    .from(attendeesTable)
    .where(eq(attendeesTable.bookingId, bookingId));

  const lead = attendees.find((a) => a.isLead) || attendees[0];
  if (!lead) {
    logger.warn({ bookingId }, "No lead attendee found for email resend");
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
      (a) => `<tr>
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
    <p>Thank you for registering for the <strong>${settings.eventName}</strong>. Your booking is confirmed.</p>
    <div class="info-box">
      <strong>Order Reference:</strong> ${booking.orderReference || `#${bookingId}`}<br>
      <strong>Pass Type:</strong> ${passLabel}<br>
      <strong>Quantity:</strong> ${booking.quantity} ${booking.quantity === 1 ? "pass" : "passes"}
    </div>
    <h3>Registered Attendees</h3>
    <table width="100%" cellspacing="0" cellpadding="0" style="font-size: 14px;">
      <thead><tr style="background: #f5f5f5;">
        <th style="padding: 8px 4px; text-align: left;">Lead</th>
        <th style="padding: 8px 4px; text-align: left;">Name</th>
        <th style="padding: 8px 4px; text-align: left;">Job Title</th>
        <th style="padding: 8px 4px; text-align: left;">Company</th>
        <th style="padding: 8px 4px; text-align: left;">Email</th>
      </tr></thead>
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
      <strong>Date:</strong> ${settings.eventDate}<br>
      <strong>Venue:</strong> ${settings.eventVenue}, ${settings.eventVenuePostcode}
    </div>
    <p>A PDF VAT receipt is attached to this email for your records.</p>
    ${booking.stripeInvoicePaymentUrl || booking.freeagentPaymentUrl ? `<p style="margin-top:16px;"><a href="${booking.stripeInvoicePaymentUrl || booking.freeagentPaymentUrl}" style="display:inline-block;background:#E74F3E;color:#fff;padding:12px 28px;text-decoration:none;font-weight:bold;font-size:15px;">Download Invoice/Pay Online →</a></p>` : ""}
    <p>We look forward to seeing you at the ${settings.eventName}!</p>
  `, settings);

  // Prefer Stripe invoice PDF, then FreeAgent PDF, then our custom receipt
  let pdfBuffer: Buffer | null = null;
  let pdfFilename = `receipt-${booking.orderReference || bookingId}.pdf`;
  const stripeInvoicePdfUrlResend = booking.stripeInvoicePdfUrl;
  if (stripeInvoicePdfUrlResend) {
    try {
      pdfBuffer = await downloadHttpsPdf(stripeInvoicePdfUrlResend);
      if (pdfBuffer) {
        pdfFilename = `invoice-${booking.orderReference || bookingId}.pdf`;
        logger.info({ bookingId, sizeBytes: pdfBuffer.length }, "Using Stripe invoice PDF for resend");
      }
    } catch (err) {
      logger.warn({ err }, "Could not download Stripe PDF for resend — falling back");
    }
  }
  if (!pdfBuffer) {
    const faInvoiceUrlResend = booking.freeagentInvoiceUrl;
    if (faInvoiceUrlResend) {
      try {
        const faToken = await getFreeAgentToken();
        if (faToken) {
          pdfBuffer = await downloadFreeAgentInvoicePdf(faInvoiceUrlResend, faToken);
          if (pdfBuffer) {
            pdfFilename = `invoice-${booking.orderReference || bookingId}.pdf`;
            logger.info({ bookingId, sizeBytes: pdfBuffer.length }, "Using FreeAgent invoice PDF for resend");
          }
        }
      } catch (err) {
        logger.warn({ err }, "Could not download FreeAgent PDF for resend — falling back to custom receipt");
      }
    }
  }
  if (!pdfBuffer) {
    try {
      pdfBuffer = await generatePdfReceipt(booking, attendees);
      if (pdfBuffer) logger.info({ bookingId, sizeBytes: pdfBuffer.length }, "Using custom PDF receipt for resend");
    } catch (err) {
      logger.error({ err }, "Failed to generate PDF for resend");
    }
  }

  const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
  if (pdfBuffer) {
    attachments.push({ filename: pdfFilename, content: pdfBuffer, contentType: "application/pdf" });
  }
  const companyInfoPdfResend = getCompanyInfoPdf();
  if (companyInfoPdfResend) {
    attachments.push({ filename: "DBL-company-information.pdf", content: companyInfoPdfResend, contentType: "application/pdf" });
  }

  const sent = await sendMail({
    to: lead.workEmail,
    subject: `Booking Confirmed — ${settings.eventName} (${booking.orderReference || `#${bookingId}`})`,
    html: confirmationHtml,
    attachments,
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
  });

  await logEmail(bookingId, lead.workEmail, "confirmation", sent ? "sent" : "failed",
    sent ? undefined : "SMTP not configured or send failed");
  if (pdfBuffer) {
    await logEmail(bookingId, lead.workEmail, "receipt", sent ? "sent" : "failed");
  }
}

export async function sendOrganiserNotification(bookingId: number): Promise<void> {
  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
  if (!booking) return;

  const storedEmails = await db
    .select()
    .from(notificationEmailsTable)
    .orderBy(notificationEmailsTable.createdAt);

  const recipients: string[] = storedEmails.map((e) => e.email);
  if (process.env.ORGANISER_EMAIL && !recipients.includes(process.env.ORGANISER_EMAIL.toLowerCase())) {
    recipients.push(process.env.ORGANISER_EMAIL);
  }

  if (recipients.length === 0) {
    logger.info({ bookingId }, "No notification recipients configured — skipping organiser notification");
    return;
  }

  const attendees = await db.select().from(attendeesTable).where(eq(attendeesTable.bookingId, bookingId));
  const lead = attendees.find((a) => a.isLead) || attendees[0];

  const passLabels: Record<string, string> = {
    single: "Single Pass",
    team: "Team Pass (3 seats)",
    business: "Business Pass",
  };

  const subtotal = parseFloat(booking.subtotalAmount?.toString() || "0");
  const vat = parseFloat(booking.vatAmount?.toString() || "0");
  const total = parseFloat(booking.totalAmount?.toString() || "0");
  const groupDiscount = parseFloat(booking.groupDiscountAmount?.toString() || "0");
  const promoDiscount = parseFloat(booking.promoDiscountAmount?.toString() || "0");

  const attendeeRows = attendees.map((a, i) => `
    <tr style="background:${i % 2 === 0 ? "#f9f9f9" : "#fff"}">
      <td style="padding:8px 10px;border:1px solid #e5e5e5">${a.firstName} ${a.lastName}${a.isLead ? ' <span style="font-size:11px;color:#E74F3E;font-weight:bold">(Buyer)</span>' : ""}</td>
      <td style="padding:8px 10px;border:1px solid #e5e5e5">${a.workEmail}</td>
      <td style="padding:8px 10px;border:1px solid #e5e5e5">${a.jobTitle || "—"}</td>
      <td style="padding:8px 10px;border:1px solid #e5e5e5">${a.company || "—"}</td>
    </tr>
  `).join("");

  const subject = `New Registration: ${booking.orderReference || `#${bookingId}`} — ${lead ? `${lead.firstName} ${lead.lastName}` : "Unknown"}`;

  const html = wrapInBrandedLayout(`
    <h2 style="margin:0 0 8px;font-size:22px">New Registration Received</h2>
    <p style="margin:0 0 24px;color:#666">A new booking has been completed on the HR Analytics Summit checkout.</p>

    <h3 style="margin:0 0 10px;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;color:#888">Order Details</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px">
      <tr><td style="padding:7px 0;color:#666;width:180px;border-bottom:1px solid #f0f0f0">Order Reference</td><td style="border-bottom:1px solid #f0f0f0"><strong style="font-family:monospace">${booking.orderReference || `#${bookingId}`}</strong></td></tr>
      <tr><td style="padding:7px 0;color:#666;border-bottom:1px solid #f0f0f0">Pass Type</td><td style="border-bottom:1px solid #f0f0f0">${passLabels[booking.passType] || booking.passType}</td></tr>
      <tr><td style="padding:7px 0;color:#666;border-bottom:1px solid #f0f0f0">Quantity</td><td style="border-bottom:1px solid #f0f0f0">${booking.quantity} ${booking.quantity === 1 ? "ticket" : "tickets"}</td></tr>
      <tr><td style="padding:7px 0;color:#666;border-bottom:1px solid #f0f0f0">Payment Method</td><td style="border-bottom:1px solid #f0f0f0">${booking.paymentMethod === "card" ? "Credit/Debit Card" : booking.paymentMethod === "invoice" ? "Invoice" : "—"}</td></tr>
      <tr><td style="padding:7px 0;color:#666;border-bottom:1px solid #f0f0f0">Status</td><td style="border-bottom:1px solid #f0f0f0"><strong style="color:${booking.status === "paid" ? "#16a34a" : "#d97706"}">${booking.status === "paid" ? "Paid" : booking.status === "invoiced" ? "Invoiced (Awaiting Payment)" : booking.status}</strong></td></tr>
      ${booking.promoCode ? `<tr><td style="padding:7px 0;color:#666;border-bottom:1px solid #f0f0f0">Promo Code</td><td style="border-bottom:1px solid #f0f0f0">${booking.promoCode}</td></tr>` : ""}
    </table>

    <h3 style="margin:0 0 10px;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;color:#888">Pricing</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px">
      <tr><td style="padding:7px 0;color:#666;width:180px;border-bottom:1px solid #f0f0f0">Base Subtotal</td><td style="border-bottom:1px solid #f0f0f0">£${subtotal.toFixed(2)}</td></tr>
      ${groupDiscount > 0 ? `<tr><td style="padding:7px 0;color:#666;border-bottom:1px solid #f0f0f0">Group Discount</td><td style="border-bottom:1px solid #f0f0f0;color:#E74F3E">-£${groupDiscount.toFixed(2)}</td></tr>` : ""}
      ${promoDiscount > 0 ? `<tr><td style="padding:7px 0;color:#666;border-bottom:1px solid #f0f0f0">Promo Discount</td><td style="border-bottom:1px solid #f0f0f0;color:#E74F3E">-£${promoDiscount.toFixed(2)}</td></tr>` : ""}
      <tr><td style="padding:7px 0;color:#666;border-bottom:1px solid #f0f0f0">VAT (20%)</td><td style="border-bottom:1px solid #f0f0f0">£${vat.toFixed(2)}</td></tr>
      <tr><td style="padding:7px 0;font-weight:bold;border-bottom:1px solid #f0f0f0">Total</td><td style="border-bottom:1px solid #f0f0f0"><strong>£${total.toFixed(2)}</strong></td></tr>
    </table>

    ${booking.paymentMethod === "invoice" && booking.billingName ? `
    <h3 style="margin:0 0 10px;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;color:#888">Billing Details</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px">
      <tr><td style="padding:7px 0;color:#666;width:180px;border-bottom:1px solid #f0f0f0">Billing Contact</td><td style="border-bottom:1px solid #f0f0f0">${booking.billingName}</td></tr>
      <tr><td style="padding:7px 0;color:#666;border-bottom:1px solid #f0f0f0">Company</td><td style="border-bottom:1px solid #f0f0f0">${booking.billingCompany || "—"}</td></tr>
      <tr><td style="padding:7px 0;color:#666;border-bottom:1px solid #f0f0f0">Invoice Email</td><td style="border-bottom:1px solid #f0f0f0">${booking.billingEmail || "—"}</td></tr>
      <tr><td style="padding:7px 0;color:#666;border-bottom:1px solid #f0f0f0">Address</td><td style="border-bottom:1px solid #f0f0f0">${(() => {
        if (booking.billingAddressLine1) {
          const cityRegion = booking.billingTown && booking.billingRegion ? `${booking.billingTown}, ${booking.billingRegion}` : (booking.billingTown || booking.billingRegion);
          return [booking.billingAddressLine1, booking.billingAddressLine2, cityRegion, booking.billingPostcode, booking.billingCountry].filter(Boolean).join("<br>");
        }
        return (booking.billingAddress || "—").replace(/\n/g, "<br>");
      })()}</td></tr>
    </table>
    ` : ""}

    <h3 style="margin:0 0 10px;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;color:#888">Attendees (${attendees.length})</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
      <thead>
        <tr style="background:#1e293b;color:#fff">
          <th style="padding:9px 10px;text-align:left;border:1px solid #1e293b">Name</th>
          <th style="padding:9px 10px;text-align:left;border:1px solid #1e293b">Work Email</th>
          <th style="padding:9px 10px;text-align:left;border:1px solid #1e293b">Job Title</th>
          <th style="padding:9px 10px;text-align:left;border:1px solid #1e293b">Company</th>
        </tr>
      </thead>
      <tbody>
        ${attendeeRows || '<tr><td colspan="4" style="padding:10px;border:1px solid #e5e5e5;color:#888">No attendee details recorded yet</td></tr>'}
      </tbody>
    </table>
  `);

  let sentCount = 0;
  for (const to of recipients) {
    try {
      await sendMail({ to, subject, html });
      sentCount++;
    } catch (err) {
      logger.error({ err, bookingId, to }, "Failed to send organiser notification");
    }
  }
  logger.info({ bookingId, sentCount, total: recipients.length }, "Organiser notifications sent");
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

    const settings = await getEventSettings();

    const personalised = template.htmlBody
      .replace(/\{\{firstName\}\}/g, firstName)
      .replace(/\{\{name\}\}/g, firstName);

    const html = wrapInBrandedLayout(personalised, settings);

    const sent = await sendMail({
      to: toEmail,
      subject: template.subject,
      html,
      fromName: settings.fromName,
      fromEmail: settings.fromEmail,
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
