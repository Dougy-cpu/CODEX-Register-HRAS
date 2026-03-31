import { google } from "googleapis";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { bookingsTable, attendeesTable } from "@workspace/db";
import { logger } from "./logger";

function getSheetsClient() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!spreadsheetId || !clientEmail || !privateKey) {
    return null;
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  return { sheets, spreadsheetId };
}

const SHEET_HEADERS = [
  "Order Reference",
  "Date",
  "Lead Name",
  "Lead Email",
  "Company",
  "Pass Type",
  "Quantity",
  "Subtotal (exc VAT)",
  "VAT",
  "Total (inc VAT)",
  "Payment Method",
  "Status",
  "Promo Code",
  "Group Discount",
  "Promo Discount",
];

async function ensureSheetHeaders(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string
): Promise<void> {
  const range = "Sheet1!A1:O1";
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range });

  if (!existing.data.values || existing.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [SHEET_HEADERS] },
    });
  }
}

export async function syncBookingToSheets(bookingId: number): Promise<void> {
  const client = getSheetsClient();
  if (!client) {
    logger.debug("Google Sheets not configured — skipping sync");
    return;
  }

  const { sheets, spreadsheetId } = client;

  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, bookingId));

  if (!booking) {
    logger.error({ bookingId }, "Booking not found for Google Sheets sync");
    return;
  }

  const allAttendees = await db
    .select()
    .from(attendeesTable)
    .where(eq(attendeesTable.bookingId, bookingId));

  const lead = allAttendees.find((a) => a.isLead) || allAttendees[0];

  await ensureSheetHeaders(sheets, spreadsheetId);

  const row = [
    booking.orderReference || `#${booking.id}`,
    new Date(booking.createdAt).toISOString().split("T")[0],
    lead ? `${lead.firstName} ${lead.lastName}` : "",
    lead?.workEmail || "",
    lead?.company || "",
    booking.passType,
    String(booking.quantity),
    booking.subtotalAmount?.toString() || "0",
    booking.vatAmount?.toString() || "0",
    booking.totalAmount?.toString() || "0",
    booking.paymentMethod || "",
    booking.status,
    booking.promoCode || "",
    booking.groupDiscountAmount?.toString() || "0",
    booking.promoDiscountAmount?.toString() || "0",
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Sheet1!A:O",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });

  logger.info({ bookingId, orderRef: booking.orderReference }, "Booking synced to Google Sheets");
}
