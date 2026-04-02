import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { bookingsTable, attendeesTable } from "@workspace/db";
import { calculatePricing } from "../lib/pricing";
import { v4 as uuidv4 } from "uuid";
import { deriveAdminToken, getAdminPassword } from "../middleware/admin-auth";
import { sendIncompleteFormNotification } from "../lib/email";
import { logger } from "../lib/logger";

function isAdminRequest(req: import("express").Request): boolean {
  const token = req.headers["x-admin-token"] as string | undefined;
  if (!token) return false;
  const password = getAdminPassword();
  if (!password) return false;
  return token === deriveAdminToken(password);
}

const router: IRouter = Router();

function generateOrderRef(bookingId?: number): string {
  if (bookingId) {
    return `HRAS26-${6541 + bookingId}`;
  }
  return `HRAS26-${6541 + Math.floor(10000 + Math.random() * 90000)}`;
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
    })
    .returning();

  res.status(201).json(formatBooking(booking));
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

  // Only admin requests may mutate status
  if (admin && status !== undefined) {
    updateData.status = status;
    if ((status === "paid" || status === "invoiced") && !existing.orderReference) {
      updateData.orderReference = generateOrderRef(id);
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
