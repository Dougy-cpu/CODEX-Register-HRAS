import { and, eq } from "drizzle-orm";
import {
  attendeesTable,
  bookingDocumentsTable,
  bookingsTable,
  db,
  type Booking,
  type Attendee,
} from "@workspace/db";
import { generatePdfReceipt } from "./pdf";
import { logger } from "./logger";

const RECEIPT_DOCUMENT_TYPE = "receipt";
const PDF_CONTENT_TYPE = "application/pdf";

function receiptFilename(booking: Pick<Booking, "id" | "orderReference">): string {
  const ref = booking.orderReference || String(booking.id);
  return `receipt-${ref}.pdf`.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function saveReceiptDocumentForBooking(
  booking: Booking,
  attendees: Attendee[],
): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  const buffer = await generatePdfReceipt(booking, attendees);
  const filename = receiptFilename(booking);

  await db
    .insert(bookingDocumentsTable)
    .values({
      bookingId: booking.id,
      documentType: RECEIPT_DOCUMENT_TYPE,
      filename,
      contentType: PDF_CONTENT_TYPE,
      data: buffer,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [bookingDocumentsTable.bookingId, bookingDocumentsTable.documentType],
      set: {
        filename,
        contentType: PDF_CONTENT_TYPE,
        data: buffer,
        updatedAt: new Date(),
      },
    });

  logger.info({ bookingId: booking.id, sizeBytes: buffer.length }, "Receipt PDF archived");
  return { buffer, filename, contentType: PDF_CONTENT_TYPE };
}

export async function getStoredReceiptDocumentForBooking(bookingId: number): Promise<{
  buffer: Buffer;
  filename: string;
  contentType: string;
} | null> {
  const [document] = await db
    .select()
    .from(bookingDocumentsTable)
    .where(
      and(
        eq(bookingDocumentsTable.bookingId, bookingId),
        eq(bookingDocumentsTable.documentType, RECEIPT_DOCUMENT_TYPE),
      ),
    );

  if (!document) return null;

  return {
    buffer: Buffer.isBuffer(document.data) ? document.data : Buffer.from(document.data),
    filename: document.filename,
    contentType: document.contentType,
  };
}

export async function getOrCreateReceiptDocumentForBooking(bookingId: number): Promise<{
  buffer: Buffer;
  filename: string;
  contentType: string;
} | null> {
  const stored = await getStoredReceiptDocumentForBooking(bookingId);
  if (stored) return stored;

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
  if (!booking) return null;

  const attendees = await db
    .select()
    .from(attendeesTable)
    .where(eq(attendeesTable.bookingId, bookingId));

  return saveReceiptDocumentForBooking(booking, attendees);
}
