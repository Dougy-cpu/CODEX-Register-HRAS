import https from "https";
import http from "http";
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

async function downloadHttpsPdf(url: string, redirectsLeft = 5): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const lib = url.startsWith("https") ? https : http;
    lib.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirectsLeft <= 0) { resolve(null); return; }
        downloadHttpsPdf(res.headers.location, redirectsLeft - 1).then(resolve);
        return;
      }
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
    ${booking.stripeInvoicePaymentUrl ? `<p style="margin-top:16px;"><a href="${booking.stripeInvoicePaymentUrl}" style="display:inline-block;background:#E74F3E;color:#fff;padding:12px 28px;text-decoration:none;font-weight:bold;font-size:15px;">Download Invoice/Pay Online →</a></p>` : ""}
    <p>We look forward to seeing you at the ${settings.eventName}!</p>
  `, settings);

  // Prefer Stripe invoice PDF, then fall back to our custom receipt
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
        logger.warn({ bookingId }, "Stripe PDF not available — falling back to custom receipt");
      }
    } catch (err) {
      logger.warn({ err }, "Could not download Stripe PDF — falling back to custom receipt");
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
  if (companyInfoPdf && booking.paymentMethod === "invoice") {
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
    ${booking.stripeInvoicePaymentUrl ? `<p style="margin-top:16px;"><a href="${booking.stripeInvoicePaymentUrl}" style="display:inline-block;background:#E74F3E;color:#fff;padding:12px 28px;text-decoration:none;font-weight:bold;font-size:15px;">Download Invoice/Pay Online →</a></p>` : ""}
    <p>We look forward to seeing you at the ${settings.eventName}!</p>
  `, settings);

  // Prefer Stripe invoice PDF, then fall back to custom receipt
  let pdfBuffer: Buffer | null = null;
  let pdfFilename = `receipt-${booking.orderReference || bookingId}.pdf`;
  const stripeInvoicePdfUrlResend = booking.stripeInvoicePdfUrl;
  if (stripeInvoicePdfUrlResend) {
    try {
      pdfBuffer = await downloadHttpsPdf(stripeInvoicePdfUrlResend);
      if (pdfBuffer) {
        pdfFilename = `invoice-${booking.orderReference || bookingId}.pdf`;
        logger.info({ bookingId, sizeBytes: pdfBuffer.length }, "Using Stripe invoice PDF for resend");
      } else {
        logger.warn({ bookingId }, "Stripe PDF not available for resend — falling back to custom receipt");
      }
    } catch (err) {
      logger.warn({ err }, "Could not download Stripe PDF for resend — falling back to custom receipt");
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
  if (companyInfoPdfResend && booking.paymentMethod === "invoice") {
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

export async function sendIncompleteFormNotification(bookingId: number): Promise<void> {
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
    logger.info({ bookingId }, "No notification recipients configured — skipping incomplete form notification");
    return;
  }

  const attendees = await db.select().from(attendeesTable).where(eq(attendeesTable.bookingId, bookingId));
  const lead = attendees.find((a) => a.isLead) || attendees[0];
  if (!lead) return;

  const passLabels: Record<string, string> = {
    single: "Single Pass (HR Professional)",
    team: "Team Pass (3 seats)",
    business: "Business Pass (Vendor/Consultant)",
  };

  const submittedAt = booking.updatedAt || booking.createdAt;
  const submittedAtStr = submittedAt
    ? new Date(submittedAt).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" })
    : "Unknown";

  const dataRows = [
    ["First Name", lead.firstName],
    ["Last Name", lead.lastName],
    ["Email", lead.workEmail],
    ["Company", lead.company || "—"],
    ["Job Title", lead.jobTitle || "—"],
    ["Pass Type", passLabels[booking.passType] || booking.passType],
    ["Quantity", String(booking.quantity)],
    ["Submitted At", submittedAtStr],
  ];

  const tableRows = dataRows.map(([label, value], i) => `
    <tr style="background:${i % 2 === 0 ? "#1e293b" : "#263548"}">
      <td style="padding:11px 16px;font-weight:bold;color:#94a3b8;font-size:13px;width:160px;border-bottom:1px solid #334155">${label}</td>
      <td style="padding:11px 16px;color:#f1f5f9;font-size:13px;border-bottom:1px solid #334155">${value}</td>
    </tr>
  `).join("");

  const subject = `Incomplete Registration: ${lead.firstName} ${lead.lastName} — HR Analytics Summit`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Helvetica Neue',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 16px">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

          <!-- Header -->
          <tr>
            <td style="background:#1e293b;padding:32px 32px 24px;border-radius:4px 4px 0 0">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#f8fafc;letter-spacing:-0.02em">
                Incomplete HR Analytics Summit Registration
              </h1>
              <p style="margin:0;font-size:14px;color:#64748b">
                HR Analytics Summit &mdash; 3 Sep 2026, 155 Bishopsgate, London
              </p>
            </td>
          </tr>

          <!-- Warning banner -->
          <tr>
            <td style="background:#854d0e;padding:12px 32px">
              <p style="margin:0;font-size:14px;color:#fef9c3">
                This person submitted their details but has <strong style="color:#fef08a">not yet completed payment</strong>.
              </p>
            </td>
          </tr>

          <!-- Data table -->
          <tr>
            <td style="background:#1e293b;padding:0">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
                ${tableRows}
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#0f172a;padding:20px 32px;border-top:1px solid #1e293b;border-radius:0 0 4px 4px">
              <p style="margin:0;font-size:12px;color:#475569">
                HR Analytics Summit &bull; Dynamic Business Leaders Limited &bull; This is an internal organiser notification.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  let sentCount = 0;
  for (const to of recipients) {
    try {
      await sendMail({ to, subject, html });
      sentCount++;
    } catch (err) {
      logger.error({ err, bookingId, to }, "Failed to send incomplete form notification");
    }
  }
  logger.info({ bookingId, sentCount, total: recipients.length }, "Incomplete form notifications sent");
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

export async function sendCheckoutExpiredEmail(bookingId: number): Promise<void> {
  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
  if (!booking) return;

  const attendees = await db.select().from(attendeesTable).where(eq(attendeesTable.bookingId, bookingId));
  const lead = attendees.find((a) => a.isLead) || attendees[0];
  if (!lead) return;

  const settings = await getEventSettings();
  const organisers = await getOrganiserEmails();

  const name = `${lead.firstName} ${lead.lastName}`;
  const checkoutUrl = settings.orgWebsite || "https://www.hranalyticssummit.com";

  const html = wrapInBrandedLayout(`
    <div style="background:#fff3cd;border:1px solid #ffc107;padding:16px 20px;border-radius:4px;margin-bottom:24px;">
      <strong style="color:#856404;">⚠ Checkout session expired</strong>
    </div>
    <h2 style="margin-top:0;">Incomplete Registration — Session Expired</h2>
    <p>Hi ${name},</p>
    <p>Your checkout session for <strong>HR Analytics Summit 2026</strong> expired before the payment was completed. This usually happens if the browser was left open for more than 24 hours without submitting payment.</p>
    <p><strong>Your booking details are still saved.</strong> To complete your registration, simply return to the checkout and restart the payment step — you won't need to re-enter your attendee information.</p>
    <p style="text-align:center;margin:32px 0;">
      <a href="${checkoutUrl}" class="cta-btn" style="display:inline-block;background:#E74F3E;color:#fff;padding:12px 28px;border-radius:300px;text-decoration:none;font-weight:600;">
        Return to Checkout →
      </a>
    </p>
    <p style="color:#666;font-size:14px;">If you have any questions, please contact us at <a href="mailto:douglas@dynamicbusinessleaders.co.uk">douglas@dynamicbusinessleaders.co.uk</a>.</p>
  `, settings);

  const recipientEmail = booking.billingEmail || lead.workEmail;

  await sendMail({
    to: recipientEmail,
    bcc: organisers.length > 0 ? organisers : undefined,
    subject: `Action Required: Your HR Analytics Summit checkout session expired — ${name}`,
    html,
  });

  logger.info({ bookingId, to: recipientEmail }, "Checkout expired email sent");
}

export async function sendRefundConfirmationEmail(bookingId: number, refundAmountPence: number): Promise<void> {
  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
  if (!booking) return;

  const attendees = await db.select().from(attendeesTable).where(eq(attendeesTable.bookingId, bookingId));
  const lead = attendees.find((a) => a.isLead) || attendees[0];
  if (!lead) return;

  const settings = await getEventSettings();
  const recipients = await getOrganiserEmails();

  const name = `${lead.firstName} ${lead.lastName}`;
  const refundAmount = (refundAmountPence / 100).toFixed(2);
  const orderRef = booking.orderReference || `HRAS26-${6541 + bookingId}`;

  const html = wrapInBrandedLayout(`
    <h2 style="margin-top:0;">Your Refund Has Been Processed</h2>
    <p>Hi ${name},</p>
    <p>We have processed a refund for your registration at <strong>HR Analytics Summit 2026</strong>. The amount will appear in your account within 5–10 business days depending on your bank.</p>
    <div class="info-box">
      <table style="width:100%;font-size:15px;">
        <tr><td style="color:#666;padding:4px 0;">Booking Reference</td><td style="text-align:right;font-family:monospace;font-weight:600;">${orderRef}</td></tr>
        <tr><td style="color:#666;padding:4px 0;">Refund Amount</td><td style="text-align:right;font-weight:700;color:#E74F3E;">£${refundAmount}</td></tr>
        <tr><td style="color:#666;padding:4px 0;">Status</td><td style="text-align:right;">Refunded &amp; Booking Cancelled</td></tr>
      </table>
    </div>
    <p>If you have any questions about your refund, please contact us at <a href="mailto:douglas@dynamicbusinessleaders.co.uk">douglas@dynamicbusinessleaders.co.uk</a> quoting your booking reference above.</p>
    <p>We hope to see you at a future event.</p>
  `, settings);

  await sendMail({
    to: booking.billingEmail || lead.workEmail,
    bcc: recipients.length > 0 ? recipients : undefined,
    subject: `Refund Confirmed — HR Analytics Summit 2026 (${orderRef})`,
    html,
  });

  logger.info({ bookingId, refundAmount }, "Refund confirmation email sent");
}

export async function sendInvoicePaymentFailedEmail(
  bookingId: number,
  declineReason?: string,
  attemptCount?: number,
): Promise<void> {
  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
  if (!booking) return;

  const attendees = await db.select().from(attendeesTable).where(eq(attendeesTable.bookingId, bookingId));
  const lead = attendees.find((a) => a.isLead) || attendees[0];
  if (!lead) return;

  const settings = await getEventSettings();
  const recipients = await getOrganiserEmails();

  const name = `${lead.firstName} ${lead.lastName}`;
  const orderRef = booking.orderReference || `HRAS26-${6541 + bookingId}`;
  const paymentUrl = booking.stripeInvoicePaymentUrl;

  const attemptNote = attemptCount
    ? `<p style="color:#666;font-size:14px;">Payment attempt: <strong>${attemptCount}</strong>.</p>`
    : "";

  const declineNote = declineReason
    ? `<div style="background:#f8d7da;border:1px solid #f5c2c7;padding:12px 16px;border-radius:4px;margin:16px 0;font-size:14px;color:#842029;">
        <strong>Reason:</strong> ${declineReason}
      </div>`
    : "";

  const html = wrapInBrandedLayout(`
    <div style="background:#fff3cd;border:1px solid #ffc107;padding:16px 20px;border-radius:4px;margin-bottom:24px;">
      <strong style="color:#856404;">⚠ Invoice payment unsuccessful</strong>
    </div>
    <h2 style="margin-top:0;">Action Required: Invoice Payment Failed</h2>
    <p>Hi ${name},</p>
    <p>We attempted to collect payment for your HR Analytics Summit 2026 invoice but the payment was unsuccessful. Your booking reference is <strong>${orderRef}</strong>.</p>
    ${declineNote}
    ${attemptNote}
    <p>Please use the button below to pay your invoice. If you continue to have difficulties, contact your bank or reach out to us directly.</p>
    ${paymentUrl ? `
    <p style="text-align:center;margin:32px 0;">
      <a href="${paymentUrl}" class="cta-btn" style="display:inline-block;background:#E74F3E;color:#fff;padding:12px 28px;border-radius:300px;text-decoration:none;font-weight:600;">
        Pay Invoice Now →
      </a>
    </p>
    ` : ""}
    <p style="color:#666;font-size:14px;">If you need assistance, email us at <a href="mailto:douglas@dynamicbusinessleaders.co.uk">douglas@dynamicbusinessleaders.co.uk</a> or call <a href="tel:+447763618052">07763 618052</a>.</p>
  `, settings);

  await sendMail({
    to: booking.billingEmail || lead.workEmail,
    bcc: recipients.length > 0 ? recipients : undefined,
    subject: `Action Required: Invoice Payment Failed — HR Analytics Summit 2026 (${orderRef})`,
    html,
  });

  logger.info({ bookingId, orderRef, declineReason, attemptCount }, "Invoice payment failed email sent");
}

export async function sendDisputeAlertEmail(
  bookingId: number,
  disputeId: string,
  disputeAmountPence: number,
  disputeReason: string,
  evidenceDueBy: Date | null,
): Promise<void> {
  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
  if (!booking) return;

  const attendees = await db.select().from(attendeesTable).where(eq(attendeesTable.bookingId, bookingId));
  const lead = attendees.find((a) => a.isLead) || attendees[0];

  const settings = await getEventSettings();
  const recipients = await getOrganiserEmails();
  if (recipients.length === 0) {
    logger.warn({ bookingId, disputeId }, "sendDisputeAlertEmail: no organiser emails configured, skipping");
    return;
  }

  const customerName = lead ? `${lead.firstName} ${lead.lastName}` : "Unknown";
  const orderRef = booking.orderReference || `HRAS26-${6541 + bookingId}`;
  const disputeAmount = (disputeAmountPence / 100).toFixed(2);
  const deadlineStr = evidenceDueBy
    ? evidenceDueBy.toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
    : "Check Stripe dashboard";
  const stripeUrl = `https://dashboard.stripe.com/disputes/${disputeId}`;

  const html = wrapInBrandedLayout(`
    <div style="background:#f8d7da;border:2px solid #dc3545;padding:16px 20px;border-radius:4px;margin-bottom:24px;">
      <strong style="color:#842029;font-size:16px;">🚨 Chargeback / Dispute Filed</strong>
    </div>
    <h2 style="margin-top:0;color:#842029;">Urgent: Payment Dispute Received</h2>
    <p>A customer has filed a chargeback with their bank. <strong>You must respond by the deadline below</strong> or the funds will be automatically returned and a dispute fee charged.</p>
    <div class="info-box">
      <table style="width:100%;font-size:15px;">
        <tr><td style="color:#666;padding:6px 0;">Booking Reference</td><td style="text-align:right;font-family:monospace;font-weight:600;">${orderRef}</td></tr>
        <tr><td style="color:#666;padding:6px 0;">Customer</td><td style="text-align:right;font-weight:600;">${customerName}</td></tr>
        <tr><td style="color:#666;padding:6px 0;">Disputed Amount</td><td style="text-align:right;font-weight:700;color:#842029;">£${disputeAmount}</td></tr>
        <tr><td style="color:#666;padding:6px 0;">Dispute Reason</td><td style="text-align:right;">${disputeReason}</td></tr>
        <tr><td style="color:#666;padding:6px 0;font-weight:700;">Evidence Deadline</td><td style="text-align:right;font-weight:700;color:#842029;">${deadlineStr}</td></tr>
      </table>
    </div>
    <p style="text-align:center;margin:32px 0;">
      <a href="${stripeUrl}" class="cta-btn" style="display:inline-block;background:#842029;color:#fff;padding:12px 28px;border-radius:300px;text-decoration:none;font-weight:600;">
        View Dispute in Stripe →
      </a>
    </p>
    <p style="font-size:14px;color:#666;">Evidence to submit typically includes: the booking confirmation email, signed terms and conditions, and any correspondence with the customer.</p>
  `, settings);

  await sendMail({
    to: recipients,
    subject: `🚨 Dispute Filed — ${orderRef} — £${disputeAmount} — Deadline: ${deadlineStr}`,
    html,
  });

  logger.info({ bookingId, disputeId, disputeAmount, deadlineStr, recipients }, "Dispute alert email sent to organisers");
}

export async function sendInvoiceReminder(bookingId: number): Promise<void> {
  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
  if (!booking) throw new Error(`Booking ${bookingId} not found`);
  if (!booking.stripeInvoicePaymentUrl && !booking.stripeInvoicePdfUrl) {
    throw new Error("No Stripe invoice found for this booking");
  }

  const attendees = await db.select().from(attendeesTable).where(eq(attendeesTable.bookingId, bookingId));
  const lead = attendees.find((a) => a.isLead) || attendees[0];
  if (!lead) throw new Error("No attendee found for booking");

  const settings = await getEventSettings();
  const to = booking.billingEmail || lead.workEmail;
  const orderRef = booking.orderReference || `HRAS26-${6541 + bookingId}`;

  const dueDate = booking.invoiceDueDate ? new Date(booking.invoiceDueDate) : null;
  const now = new Date();
  const isOverdue = dueDate ? dueDate < now : false;
  const dueDateStr = dueDate
    ? dueDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : "14 days from invoice issue";

  const passLabels: Record<string, string> = {
    single: "Single Pass — HR Professional",
    business: "Business Pass — Vendor/Consultant",
  };
  const passLabel = passLabels[booking.passType] || booking.passType;
  const totalAmount = parseFloat(booking.totalAmount?.toString() || "0").toFixed(2);
  const vatAmount = parseFloat(booking.vatAmount?.toString() || "0").toFixed(2);
  const subtotalAfterDiscounts = parseFloat(booking.subtotalAmount?.toString() || "0");
  const groupDiscount = parseFloat(booking.groupDiscountAmount?.toString() || "0");
  const promoDiscount = parseFloat(booking.promoDiscountAmount?.toString() || "0");
  const baseAmount = subtotalAfterDiscounts + groupDiscount + promoDiscount;

  const subject = isOverdue
    ? `Overdue Invoice — ${orderRef} — HR Analytics Summit 2026`
    : `Invoice Reminder — ${orderRef} — HR Analytics Summit 2026`;

  const recipientName = booking.billingName || `${lead.firstName} ${lead.lastName}`;

  const html = wrapInBrandedLayout(`
    <div style="background:${isOverdue ? "#fff3cd" : "#e8f4fd"};border-left:4px solid ${isOverdue ? "#E74F3E" : "#F48847"};padding:16px 20px;border-radius:4px;margin-bottom:24px;">
      <strong style="color:${isOverdue ? "#E74F3E" : "#F48847"};font-size:15px;">${isOverdue ? "⚠️ Invoice Overdue" : "📋 Invoice Reminder"}</strong>
    </div>

    <p>Dear ${recipientName},</p>
    <p>${isOverdue
      ? `We are writing to remind you that invoice <strong>${orderRef}</strong> for your registration to the <strong>HR Analytics Summit 2026</strong> was due on <strong>${dueDateStr}</strong> and remains unpaid.`
      : `This is a friendly reminder that invoice <strong>${orderRef}</strong> for your registration to the <strong>HR Analytics Summit 2026</strong> is due on <strong>${dueDateStr}</strong>.`
    }</p>
    <p>Please arrange payment at your earliest convenience using the details below. A copy of the invoice PDF is attached to this email for your reference.</p>

    <div class="info-box" style="margin-bottom:24px;">
      <strong>Order Details</strong><br><br>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 0;color:#666;width:180px;border-bottom:1px solid #f0f0f0">Reference</td><td style="border-bottom:1px solid #f0f0f0;font-family:monospace;font-weight:600;">${orderRef}</td></tr>
        <tr><td style="padding:6px 0;color:#666;border-bottom:1px solid #f0f0f0">Event</td><td style="border-bottom:1px solid #f0f0f0">HR Analytics Summit 2026, 3 September 2026</td></tr>
        <tr><td style="padding:6px 0;color:#666;border-bottom:1px solid #f0f0f0">Venue</td><td style="border-bottom:1px solid #f0f0f0">155 Bishopsgate, London EC2M 3TQ</td></tr>
        <tr><td style="padding:6px 0;color:#666;border-bottom:1px solid #f0f0f0">Pass Type</td><td style="border-bottom:1px solid #f0f0f0">${passLabel}</td></tr>
        <tr><td style="padding:6px 0;color:#666;border-bottom:1px solid #f0f0f0">Quantity</td><td style="border-bottom:1px solid #f0f0f0">${booking.quantity}</td></tr>
        <tr><td style="padding:6px 0;color:#666;border-bottom:1px solid #f0f0f0">Net Amount</td><td style="border-bottom:1px solid #f0f0f0">£${baseAmount.toFixed(2)}</td></tr>
        ${groupDiscount > 0 ? `<tr><td style="padding:6px 0;color:#666;border-bottom:1px solid #f0f0f0">Group Discount</td><td style="border-bottom:1px solid #f0f0f0;color:#E74F3E">-£${groupDiscount.toFixed(2)}</td></tr>` : ""}
        ${promoDiscount > 0 ? `<tr><td style="padding:6px 0;color:#666;border-bottom:1px solid #f0f0f0">Promo Discount</td><td style="border-bottom:1px solid #f0f0f0;color:#E74F3E">-£${promoDiscount.toFixed(2)}</td></tr>` : ""}
        <tr><td style="padding:6px 0;color:#666;border-bottom:1px solid #f0f0f0">VAT (20%)</td><td style="border-bottom:1px solid #f0f0f0">£${vatAmount}</td></tr>
        <tr><td style="padding:6px 0;font-weight:700;border-bottom:1px solid #f0f0f0">Total Due</td><td style="border-bottom:1px solid #f0f0f0"><strong style="font-size:16px;">£${totalAmount}</strong></td></tr>
        <tr><td style="padding:6px 0;color:${isOverdue ? "#E74F3E" : "#888"};border-bottom:1px solid #f0f0f0">Invoice Due</td><td style="border-bottom:1px solid #f0f0f0;color:${isOverdue ? "#E74F3E" : "inherit"};font-weight:${isOverdue ? "700" : "400"};">${dueDateStr}${isOverdue ? " — OVERDUE" : ""}</td></tr>
      </table>
    </div>

    ${booking.stripeInvoicePaymentUrl ? `
    <p style="margin:24px 0;text-align:center;">
      <a href="${booking.stripeInvoicePaymentUrl}" style="display:inline-block;background:#E74F3E;color:#fff;padding:14px 32px;text-decoration:none;font-weight:bold;font-size:15px;border-radius:4px;">Pay Invoice Online →</a>
    </p>
    ` : ""}

    <div class="info-box" style="margin-bottom:24px;">
      <strong>Bank Transfer Details</strong><br><br>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 0;color:#666;width:180px;border-bottom:1px solid #f0f0f0">Account Name</td><td style="border-bottom:1px solid #f0f0f0">Dynamic Business Leaders Limited</td></tr>
        <tr><td style="padding:6px 0;color:#666;border-bottom:1px solid #f0f0f0">Bank</td><td style="border-bottom:1px solid #f0f0f0">Tide (ClearBank)</td></tr>
        <tr><td style="padding:6px 0;color:#666;border-bottom:1px solid #f0f0f0">Sort Code</td><td style="border-bottom:1px solid #f0f0f0;font-family:monospace;font-weight:600;">04-06-05</td></tr>
        <tr><td style="padding:6px 0;color:#666;border-bottom:1px solid #f0f0f0">Account Number</td><td style="border-bottom:1px solid #f0f0f0;font-family:monospace;font-weight:600;">16963209</td></tr>
        <tr><td style="padding:6px 0;color:#666;border-bottom:1px solid #f0f0f0">IBAN (GBP)</td><td style="border-bottom:1px solid #f0f0f0;font-family:monospace;">GB65CLRB04060516963209</td></tr>
        <tr><td style="padding:6px 0;color:#666;border-bottom:1px solid #f0f0f0">SWIFT/BIC</td><td style="border-bottom:1px solid #f0f0f0;font-family:monospace;">CLRBGB22</td></tr>
        <tr><td style="padding:6px 0;color:#666;border-bottom:1px solid #f0f0f0">Reference</td><td style="border-bottom:1px solid #f0f0f0;font-family:monospace;font-weight:600;">${orderRef}</td></tr>
      </table>
    </div>

    <p style="font-size:14px;color:#666;">If you have already arranged payment, please disregard this email. For queries, please contact <a href="mailto:douglas@dynamicbusinessleaders.co.uk">douglas@dynamicbusinessleaders.co.uk</a>.</p>
    <p style="font-size:14px;color:#666;"><strong>Dynamic Business Leaders Limited</strong> · Company No. 12252258 · VAT No. 336124621</p>
  `, settings);

  let pdfBuffer: Buffer | null = null;
  let pdfFilename = `invoice-${orderRef}.pdf`;
  if (booking.stripeInvoicePdfUrl) {
    try {
      pdfBuffer = await downloadHttpsPdf(booking.stripeInvoicePdfUrl);
      if (pdfBuffer) logger.info({ bookingId, sizeBytes: pdfBuffer.length }, "Stripe invoice PDF attached to reminder");
    } catch (err) {
      logger.warn({ err }, "Could not download Stripe PDF for reminder — attaching custom receipt");
    }
  }
  if (!pdfBuffer) {
    try {
      pdfBuffer = await generatePdfReceipt(booking, attendees);
    } catch (err) {
      logger.warn({ err }, "Could not generate PDF receipt for reminder");
    }
  }

  const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
  if (pdfBuffer) attachments.push({ filename: pdfFilename, content: pdfBuffer, contentType: "application/pdf" });
  const companyInfoPdf = getCompanyInfoPdf();
  if (companyInfoPdf) attachments.push({ filename: "DBL-company-information.pdf", content: companyInfoPdf, contentType: "application/pdf" });

  await sendMail({ to, subject, html, attachments });
  logger.info({ bookingId, to, orderRef, isOverdue }, "Invoice reminder email sent");
}
