import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { attendeesTable, bookingsTable } from "@workspace/db";
import { deriveAdminToken } from "../middleware/admin-auth";

const router: IRouter = Router();

function formatAttendee(a: typeof attendeesTable.$inferSelect) {
  return {
    ...a,
    gdprConsentAt: a.gdprConsentAt ? a.gdprConsentAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

function isAdminRequest(req: import("express").Request): boolean {
  const token = req.headers["x-admin-token"] as string | undefined;
  if (!token) return false;
  const password = process.env.ADMIN_PASSWORD || "admin123";
  return token === deriveAdminToken(password);
}

router.post("/bookings/:bookingId/attendees", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.bookingId) ? req.params.bookingId[0] : req.params.bookingId;
  const bookingId = parseInt(raw, 10);

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  if (!isAdminRequest(req)) {
    const sessionToken = req.headers["x-booking-session"] as string | undefined;
    if (!sessionToken || sessionToken !== booking.sessionToken) {
      res.status(403).json({ error: "Forbidden — session token mismatch" });
      return;
    }
  }

  const { firstName, lastName, jobTitle, company, workEmail, phone, gdprConsent, isLead, seatIndex } = req.body;

  if (!firstName || !lastName || !jobTitle || !company || !workEmail) {
    res.status(400).json({ error: "firstName, lastName, jobTitle, company, workEmail are required" });
    return;
  }

  const [attendee] = await db
    .insert(attendeesTable)
    .values({
      bookingId,
      firstName,
      lastName,
      jobTitle,
      company,
      workEmail,
      phone: phone || null,
      gdprConsent: !!gdprConsent,
      gdprConsentAt: gdprConsent ? new Date() : null,
      isLead: !!isLead,
      seatIndex: seatIndex ?? 0,
    })
    .returning();

  res.status(201).json(formatAttendee(attendee));
});

router.patch("/bookings/:bookingId/attendees/:attendeeId", async (req, res): Promise<void> => {
  const rawBooking = Array.isArray(req.params.bookingId) ? req.params.bookingId[0] : req.params.bookingId;
  const rawAttendee = Array.isArray(req.params.attendeeId) ? req.params.attendeeId[0] : req.params.attendeeId;
  const bookingId = parseInt(rawBooking, 10);
  const attendeeId = parseInt(rawAttendee, 10);

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  if (!isAdminRequest(req)) {
    const sessionToken = req.headers["x-booking-session"] as string | undefined;
    if (!sessionToken || sessionToken !== booking.sessionToken) {
      res.status(403).json({ error: "Forbidden — session token mismatch" });
      return;
    }
  }

  const [existing] = await db
    .select()
    .from(attendeesTable)
    .where(and(eq(attendeesTable.id, attendeeId), eq(attendeesTable.bookingId, bookingId)));

  if (!existing) {
    res.status(404).json({ error: "Attendee not found" });
    return;
  }

  const { firstName, lastName, jobTitle, company, workEmail, phone, gdprConsent } = req.body;

  const updateData: Partial<typeof attendeesTable.$inferInsert> = {};
  if (firstName !== undefined) updateData.firstName = firstName;
  if (lastName !== undefined) updateData.lastName = lastName;
  if (jobTitle !== undefined) updateData.jobTitle = jobTitle;
  if (company !== undefined) updateData.company = company;
  if (workEmail !== undefined) updateData.workEmail = workEmail;
  if (phone !== undefined) updateData.phone = phone || null;
  if (gdprConsent !== undefined) {
    updateData.gdprConsent = !!gdprConsent;
    updateData.gdprConsentAt = gdprConsent ? new Date() : null;
  }

  const [updated] = await db
    .update(attendeesTable)
    .set(updateData)
    .where(eq(attendeesTable.id, attendeeId))
    .returning();

  res.json(formatAttendee(updated));
});

export default router;
