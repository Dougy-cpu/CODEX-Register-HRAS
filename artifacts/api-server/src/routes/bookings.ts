import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { bookingsTable, attendeesTable, eventSettingsTable } from "@workspace/db";
import { calculatePricing } from "../lib/pricing";
import { v4 as uuidv4 } from "uuid";
import { deriveAdminToken, getAdminPassword } from "../middleware/admin-auth";
import { sendIncompleteFormNotification, sendBookingEmails, sendOrganiserNotification } from "../lib/email";
import { logger } from "../lib/logger";

function isAdminRequest(req: import("express").Request): boolean {
  const token = req.headers["x-admin-token"] as string | undefined;
  if (!token) return false;
  const password = getAdminPassword();
  if (!password) return false;
  return token === deriveAdminToken(password);
}

const router: IRouter = Router();

async function generateOrderRef(bookingId?: number): Promise<string> {
  const [settings] = await db.select({
    refPrefix: eventSettingsTable.refPrefix,
    refOffset: eventSettingsTable.refOffset,
  }).from(eventSettingsTable).limit(1);
  const prefix = settings?.refPrefix ?? "HRAS26";
  const offset = settings?.refOffset ?? 6541;
  if (bookingId) {
    return `${prefix}-${offset + bookingId}`;
  }
  return `${prefix}-${offset + Math.floor(10000 + Math.random() * 90000)}`;
}

function formatBooking(b: typeof bookingsTable.$inferSelect) {
  return {
    ...b,
    subtotalAmount: parseFloat(b.subtotalAmount?.toString() || "0"),
    vatAmount: parseFloat(b.vatAmount?.toString() || "0"),
    totalAmount: parseFloat(b.totalAmount?.toString() || "0"),
    promoDiscountAmount: b.promoDiscountAmount ? parseFloat(b.promoDiscountAmount.toString()) : null,
    groupDiscountAmount: b.groupDiscountAmount ? parseFloat(b.groupDiscountAmount.toString()) : null,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

function formatAttendee(a: typeof attendeesTable.$inferSelect) {
  return {
    ...a,
    gdprConsentAt: a.gdprConsentAt ? a.gdprConsentAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

router.post("/bookings", async (req, res): Promise<void> => {
  const { sessionToken, passType, attendeeType, quantity = 1, currentStep = 1 } = req.body;

  if (!sessionToken || !passType || !attendeeType) {
    res.status(400).json({ error: "sessionToken, passType, and attendeeType are required" });
    return;
  }

  const existing = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.sessionToken, sessionToken));

  if (existing.length > 0) {
    const pricing = await calculatePricing(passType, quantity);
    const [updated] = await db
      .update(bookingsTable)
      .set({
        passType,
        attendeeType,
        quantity,
        subtotalAmount: pricing.subtotalAfterDiscounts.toString(),
        vatAmount: pricing.vatAmount.toString(),
        totalAmount: pricing.total.toString(),
        groupDiscountAmount: pricing.groupDiscountAmount > 0 ? pricing.groupDiscountAmount.toString() : null,
        currentStep: Math.max(currentStep, existing[0].currentStep),
      })
      .where(eq(bookingsTable.id, existing[0].id))
      .returning();
    res.status(201).json(formatBooking(updated));
    return;
  }

  const pricing = await calculatePricing(passType, quantity);

  const [booking] = await db
    .insert(bookingsTable)
    .values({
      sessionToken,
      passType,
      attendeeType,
      quantity,
      status: "partial",
      subtotalAmount: pricing.subtotalAfterDiscounts.toString(),
      vatAmount: pricing.vatAmount.toString(),
      totalAmount: pricing.total.toString(),
      groupDiscountAmount: pricing.groupDiscountAmount > 0 ? pricing.groupDiscountAmount.toString() : null,
      currentStep,
      managementToken: uuidv4(),
    })
    .returning();

  res.status(201).json(formatBooking(booking));
});

router.post("/bookings/start", async (req, res): Promise<void> => {
  const {
    sessionToken,
    attendeeType,
    passType = "single",
    quantity = 1,
    firstName,
    lastName,
    jobTitle,
    company,
    workEmail,
    phone,
    gdprConsent,
  } = req.body;

  if (!sessionToken || !attendeeType || !firstName || !lastName || !jobTitle || !company || !workEmail) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const [existing] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.sessionToken, sessionToken));

  const pricing = await calculatePricing(passType, quantity);
  const gdprConsentAt = gdprConsent ? new Date() : null;
  const managementToken = uuidv4();

  const { finalBooking, attendee } = await db.transaction(async (tx) => {
    let bookingId: number;

    if (existing) {
      const [updated] = await tx
        .update(bookingsTable)
        .set({
          passType,
          attendeeType,
          quantity,
          subtotalAmount: pricing.subtotalAfterDiscounts.toString(),
          vatAmount: pricing.vatAmount.toString(),
          totalAmount: pricing.total.toString(),
          groupDiscountAmount: pricing.groupDiscountAmount > 0 ? pricing.groupDiscountAmount.toString() : null,
          currentStep: Math.max(2, existing.currentStep),
        })
        .where(eq(bookingsTable.id, existing.id))
        .returning();
      bookingId = updated.id;
    } else {
      const [created] = await tx
        .insert(bookingsTable)
        .values({
          sessionToken,
          passType,
          attendeeType,
          quantity,
          status: "partial",
          subtotalAmount: pricing.subtotalAfterDiscounts.toString(),
          vatAmount: pricing.vatAmount.toString(),
          totalAmount: pricing.total.toString(),
          groupDiscountAmount: pricing.groupDiscountAmount > 0 ? pricing.groupDiscountAmount.toString() : null,
          currentStep: 2,
          managementToken,
        })
        .returning();
      bookingId = created.id;
    }

    const [existingAttendee] = existing
      ? await tx
          .select()
          .from(attendeesTable)
          .where(and(eq(attendeesTable.bookingId, bookingId), eq(attendeesTable.isLead, true)))
      : [undefined];

    let attendee: typeof attendeesTable.$inferSelect;

    if (existingAttendee) {
      const [updated] = await tx
        .update(attendeesTable)
        .set({ firstName, lastName, jobTitle, company, workEmail, phone: phone || null, gdprConsent: gdprConsent ?? false, gdprConsentAt })
        .where(eq(attendeesTable.id, existingAttendee.id))
        .returning();
      attendee = updated;
    } else {
      const [created] = await tx
        .insert(attendeesTable)
        .values({ bookingId, isLead: true, firstName, lastName, jobTitle, company, workEmail, phone: phone || null, gdprConsent: gdprConsent ?? false, gdprConsentAt, seatIndex: 0 })
        .returning();
      attendee = created;
    }

    const [finalBooking] = await tx
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId));

    return { finalBooking, attendee };
  });

  const allAttendees = await db
    .select()
    .from(attendeesTable)
    .where(eq(attendeesTable.bookingId, finalBooking.id));

  res.status(200).json({
    ...formatBooking(finalBooking),
    attendees: allAttendees.map(formatAttendee),
  });
});

router.get("/bookings/by-session/:sessionToken", async (req, res): Promise<void> => {
  const { sessionToken } = req.params;
  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.sessionToken, sessionToken));

  if (!booking) {
    res.json(null);
    return;
  }

  const attendees = await db
    .select()
    .from(attendeesTable)
    .where(eq(attendeesTable.bookingId, booking.id));

  res.json({
    ...formatBooking(booking),
    attendees: attendees.map(formatAttendee),
  });
});

router.get("/bookings/by-management-token/:token", async (req, res): Promise<void> => {
  const { token } = req.params;

  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.managementToken, token));

  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  const [attendees, settingsRows] = await Promise.all([
    db.select().from(attendeesTable).where(eq(attendeesTable.bookingId, booking.id)),
    db.select().from(eventSettingsTable).limit(1),
  ]);

  const settings = settingsRows[0];
  const changesLocked = settings?.attendeeChangesLocked ?? false;
  const lockedMessage = settings?.attendeeChangesLockedMessage ?? null;

  res.json({
    ...formatBooking(booking),
    attendees: attendees.map(formatAttendee),
    changesLocked,
    lockedMessage,
  });
});

router.get("/bookings/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id));
  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  const sessionHeader = req.headers["x-booking-session"] as string | undefined;
  const ownsBooking = sessionHeader && booking.sessionToken && sessionHeader === booking.sessionToken;
  if (!ownsBooking && !isAdminRequest(req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const attendees = await db
    .select()
    .from(attendeesTable)
    .where(eq(attendeesTable.bookingId, id));

  res.json({
    ...formatBooking(booking),
    attendees: attendees.map(formatAttendee),
  });
});

router.patch("/bookings/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const [existing] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  const admin = isAdminRequest(req);

  if (!admin) {
    const sessionToken = req.headers["x-booking-session"] as string | undefined;
    if (!sessionToken || sessionToken !== existing.sessionToken) {
      res.status(403).json({ error: "Forbidden — session token mismatch" });
      return;
    }
  }

  const {
    passType,
    attendeeType,
    quantity,
    promoCode,
    hearAboutUs,
    paymentMethod,
    currentStep,
    billingName,
    billingCompany,
    billingEmail,
    billingAddress,
    billingAddressLine1,
    billingAddressLine2,
    billingTown,
    billingRegion,
    billingPostcode,
    billingCountry,
    billingPhone,
    billingVatNumber,
    // status is admin/webhook-only — excluded from public PATCH body
    status,
  } = req.body;

  const newPassType = passType ?? existing.passType;
  const newQuantity = quantity ?? existing.quantity;
  const newPromoCode = promoCode !== undefined
    ? (promoCode ? promoCode.toUpperCase() : null)
    : existing.promoCode;

  const pricing = await calculatePricing(newPassType, newQuantity, newPromoCode);

  const updateData: Partial<typeof bookingsTable.$inferInsert> = {
    subtotalAmount: pricing.subtotalAfterDiscounts.toString(),
    vatAmount: pricing.vatAmount.toString(),
    totalAmount: pricing.total.toString(),
    groupDiscountAmount: pricing.groupDiscountAmount > 0 ? pricing.groupDiscountAmount.toString() : null,
    promoDiscountAmount: pricing.promoDiscountAmount > 0 ? pricing.promoDiscountAmount.toString() : null,
  };

  if (passType !== undefined) updateData.passType = passType;
  if (attendeeType !== undefined) updateData.attendeeType = attendeeType;
  if (quantity !== undefined) updateData.quantity = quantity;
  if (promoCode !== undefined) updateData.promoCode = promoCode ? promoCode.toUpperCase() : null;
  if (paymentMethod !== undefined) updateData.paymentMethod = paymentMethod;
  if (currentStep !== undefined) updateData.currentStep = currentStep;
  if (billingName !== undefined) updateData.billingName = billingName;
  if (billingCompany !== undefined) updateData.billingCompany = billingCompany;
  if (billingEmail !== undefined) updateData.billingEmail = billingEmail;
  if (billingAddress !== undefined) updateData.billingAddress = billingAddress;
  if (billingAddressLine1 !== undefined) updateData.billingAddressLine1 = billingAddressLine1;
  if (billingAddressLine2 !== undefined) updateData.billingAddressLine2 = billingAddressLine2;
  if (billingTown !== undefined) updateData.billingTown = billingTown;
  if (billingRegion !== undefined) updateData.billingRegion = billingRegion;
  if (billingPostcode !== undefined) updateData.billingPostcode = billingPostcode;
  if (billingCountry !== undefined) updateData.billingCountry = billingCountry;
  if (billingPhone !== undefined) updateData.billingPhone = billingPhone || null;
  if (billingVatNumber !== undefined) updateData.billingVatNumber = billingVatNumber || null;
  if (hearAboutUs !== undefined) updateData.hearAboutUs = hearAboutUs || null;

  // Only admin requests may mutate status
  if (admin && status !== undefined) {
    updateData.status = status;
    if ((status === "paid" || status === "invoiced") && !existing.orderReference) {
      updateData.orderReference = await generateOrderRef(id);
    }
  }

  const [updated] = await db
    .update(bookingsTable)
    .set(updateData)
    .where(eq(bookingsTable.id, id))
    .returning();

  res.json(formatBooking(updated));
});

// Fire-and-forget endpoint called by the frontend via sendBeacon or setTimeout when the
// user leaves Step 4 without completing payment. Uses the same atomic partialNotificationSent
// flag to guarantee the notification is sent at most once.
router.post("/bookings/:id/incomplete-ping", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  res.status(202).json({ ok: true }); // Respond immediately — processing continues async

  try {
    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id));
    if (!booking || booking.status !== "partial" || booking.partialNotificationSent) return;

    const claimed = await db
      .update(bookingsTable)
      .set({ partialNotificationSent: true })
      .where(and(eq(bookingsTable.id, id), eq(bookingsTable.partialNotificationSent, false)))
      .returning({ id: bookingsTable.id });

    if (claimed.length > 0) {
      await sendIncompleteFormNotification(id);
    }
  } catch (err) {
    logger.error({ err, bookingId: id }, "Failed to process incomplete-ping");
  }
});

// Confirm a booking that has a total of £0 (fully covered by promo code).
// Marks the booking as paid and sends confirmation emails.
router.post("/bookings/:id/confirm-free", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const [existing] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  const sessionToken = req.headers["x-booking-session"] as string | undefined;
  if (!sessionToken || sessionToken !== existing.sessionToken) {
    res.status(403).json({ error: "Forbidden — session token mismatch" });
    return;
  }

  if (existing.status === "paid" || existing.status === "invoiced") {
    res.json({ alreadyConfirmed: true, orderReference: existing.orderReference });
    return;
  }

  const pricing = await calculatePricing(existing.passType, existing.quantity, existing.promoCode);

  if (pricing.total > 0) {
    res.status(400).json({ error: "Booking total is not zero — payment required" });
    return;
  }

  const orderRef = await generateOrderRef(id);

  await db
    .update(bookingsTable)
    .set({ status: "paid", currentStep: 5, orderReference: orderRef, updatedAt: new Date() })
    .where(eq(bookingsTable.id, id));

  try { await sendBookingEmails(id); } catch (err) { logger.error({ err, bookingId: id }, "confirm-free: failed to send confirmation emails"); }
  try { await sendOrganiserNotification(id); } catch (err) { logger.error({ err, bookingId: id }, "confirm-free: failed to send organiser notification"); }

  res.json({ confirmed: true, orderReference: orderRef });
});

router.get("/bookings/:id/pricing", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id));
  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  const promoCode = req.query.promoCode as string | undefined;
  const pricing = await calculatePricing(booking.passType, booking.quantity, promoCode || booking.promoCode);

  res.json(pricing);
});

export default router;
