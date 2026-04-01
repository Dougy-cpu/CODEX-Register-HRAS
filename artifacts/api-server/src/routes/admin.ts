import { Router, type IRouter } from "express";
import { eq, desc, ilike, or, and, sql, count } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db } from "@workspace/db";
import {
  bookingsTable,
  attendeesTable,
  promoCodesTable,
  discountTiersTable,
  notificationEmailsTable,
  passInventoryTable,
} from "@workspace/db";
import { adminAuth, deriveAdminToken, getAdminPassword } from "../middleware/admin-auth";

const router: IRouter = Router();

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

function formatPromoCode(p: typeof promoCodesTable.$inferSelect) {
  return {
    ...p,
    discountValue: parseFloat(p.discountValue.toString()),
    validFrom: p.validFrom ? p.validFrom.toISOString() : null,
    validUntil: p.validUntil ? p.validUntil.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
  };
}

function formatTier(t: typeof discountTiersTable.$inferSelect) {
  return {
    ...t,
    discountPercent: parseFloat(t.discountPercent.toString()),
  };
}

router.post("/admin/login", async (req, res): Promise<void> => {
  const { password } = req.body;
  const adminPassword = getAdminPassword();

  if (!adminPassword) {
    res.status(503).json({ error: "Admin authentication not configured — set a secure ADMIN_PASSWORD" });
    return;
  }

  if (!password || password !== adminPassword) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = deriveAdminToken(adminPassword);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  res.json({ token, expiresAt: expiresAt.toISOString() });
});

router.get("/admin/stats", adminAuth, async (_req, res): Promise<void> => {
  const allBookings = await db.select().from(bookingsTable);

  const completed = allBookings.filter((b) => b.status === "paid" || b.status === "invoiced");
  const partial = allBookings.filter((b) => b.status === "partial");

  const totalRevenue = completed.reduce(
    (sum, b) => sum + parseFloat(b.totalAmount?.toString() || "0"),
    0
  );
  const totalVat = completed.reduce(
    (sum, b) => sum + parseFloat(b.vatAmount?.toString() || "0"),
    0
  );

  const passCounts = {
    single: allBookings.filter((b) => b.passType === "single").length,
    team: allBookings.filter((b) => b.passType === "team").length,
    business: allBookings.filter((b) => b.passType === "business").length,
  };

  const paymentMethodCounts = {
    card: completed.filter((b) => b.paymentMethod === "card").length,
    invoice: completed.filter((b) => b.paymentMethod === "invoice").length,
  };

  const allAttendees = await db.select().from(attendeesTable);

  const recentBookings = allBookings
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 10);

  const recentWithLeads = await Promise.all(
    recentBookings.map(async (booking) => {
      const lead = allAttendees.find((a) => a.bookingId === booking.id && a.isLead);
      return {
        ...formatBooking(booking),
        leadName: lead ? `${lead.firstName} ${lead.lastName}` : null,
        leadEmail: lead?.workEmail || null,
        leadCompany: lead?.company || null,
      };
    })
  );

  res.json({
    totalRegistrations: allBookings.length,
    completedRegistrations: completed.length,
    partialRegistrations: partial.length,
    totalRevenue: parseFloat(totalRevenue.toFixed(2)),
    totalVat: parseFloat(totalVat.toFixed(2)),
    passCounts,
    paymentMethodCounts,
    recentRegistrations: recentWithLeads,
  });
});

router.get("/admin/registrations", adminAuth, async (req, res): Promise<void> => {
  const page = parseInt(req.query.page as string || "1", 10);
  const limit = parseInt(req.query.limit as string || "25", 10);
  const offset = (page - 1) * limit;
  const statusFilter = req.query.status as string | undefined;
  const search = req.query.search as string | undefined;

  const allBookings = await db.select().from(bookingsTable).orderBy(desc(bookingsTable.createdAt));
  const allAttendees = await db.select().from(attendeesTable);

  let filtered = allBookings;
  if (statusFilter) {
    filtered = filtered.filter((b) => b.status === statusFilter);
  }

  if (search) {
    const searchLower = search.toLowerCase();
    const matchingAttendeeBookingIds = allAttendees
      .filter(
        (a) =>
          a.firstName.toLowerCase().includes(searchLower) ||
          a.lastName.toLowerCase().includes(searchLower) ||
          a.workEmail.toLowerCase().includes(searchLower) ||
          a.company.toLowerCase().includes(searchLower)
      )
      .map((a) => a.bookingId);

    filtered = filtered.filter(
      (b) =>
        matchingAttendeeBookingIds.includes(b.id) ||
        (b.orderReference && b.orderReference.toLowerCase().includes(searchLower))
    );
  }

  const total = filtered.length;
  const paginated = filtered.slice(offset, offset + limit);

  const result = paginated.map((booking) => {
    const lead = allAttendees.find((a) => a.bookingId === booking.id && a.isLead);
    return {
      ...formatBooking(booking),
      leadName: lead ? `${lead.firstName} ${lead.lastName}` : null,
      leadEmail: lead?.workEmail || null,
      leadCompany: lead?.company || null,
    };
  });

  res.json({ registrations: result, total, page, limit });
});

router.get("/admin/registrations/export", adminAuth, async (req, res): Promise<void> => {
  const statusFilter = req.query.status as string | undefined;

  let bookings = await db.select().from(bookingsTable).orderBy(desc(bookingsTable.createdAt));
  if (statusFilter) {
    bookings = bookings.filter((b) => b.status === statusFilter);
  }

  const allAttendees = await db.select().from(attendeesTable);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "HR Analytics Summit";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Registrations");

  const columns: ExcelJS.Column[] = [
    { header: "Booking Reference", key: "bookingRef", width: 18 },
    { header: "Status", key: "status", width: 14 },
    { header: "Pass Type", key: "passType", width: 14 },
    { header: "Qty", key: "qty", width: 6 },
    { header: "Subtotal (ex VAT) £", key: "subtotal", width: 18 },
    { header: "VAT £", key: "vat", width: 10 },
    { header: "Total £", key: "total", width: 10 },
    { header: "Payment Method", key: "paymentMethod", width: 16 },
    { header: "Invoice Ref", key: "invoiceRef", width: 16 },
    { header: "Billing Name", key: "billingName", width: 20 },
    { header: "Billing Company", key: "billingCompany", width: 24 },
    { header: "Billing Email", key: "billingEmail", width: 26 },
    { header: "Lead", key: "lead", width: 6 },
    { header: "First Name", key: "firstName", width: 16 },
    { header: "Last Name", key: "lastName", width: 16 },
    { header: "Job Title", key: "jobTitle", width: 26 },
    { header: "Company", key: "company", width: 24 },
    { header: "Work Email", key: "workEmail", width: 28 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Dietary / Access", key: "dietary", width: 22 },
    { header: "GDPR Consent", key: "gdpr", width: 14 },
    { header: "Registered At", key: "registeredAt", width: 22 },
  ] as ExcelJS.Column[];
  sheet.columns = columns;

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
  headerRow.alignment = { vertical: "middle" };
  headerRow.height = 22;

  for (const booking of bookings) {
    const bookingAttendees = allAttendees
      .filter((a) => a.bookingId === booking.id)
      .sort((a, b) => (a.seatIndex ?? 0) - (b.seatIndex ?? 0));

    if (bookingAttendees.length === 0) {
      sheet.addRow({
        bookingRef: booking.orderReference || "",
        status: booking.status,
        passType: booking.passType,
        qty: booking.quantity,
        subtotal: parseFloat(booking.subtotalAmount?.toString() || "0"),
        vat: parseFloat(booking.vatAmount?.toString() || "0"),
        total: parseFloat(booking.totalAmount?.toString() || "0"),
        paymentMethod: booking.paymentMethod || "",
        invoiceRef: booking.orderReference || "",
        billingName: booking.billingName || "",
        billingCompany: booking.billingCompany || "",
        billingEmail: booking.billingEmail || "",
        lead: "",
        firstName: "",
        lastName: "",
        jobTitle: "",
        company: "",
        workEmail: "",
        phone: "",
        dietary: "",
        gdpr: "",
        registeredAt: booking.createdAt.toISOString(),
      });
      continue;
    }

    for (const a of bookingAttendees) {
      const row = sheet.addRow({
        bookingRef: booking.orderReference || "",
        status: booking.status,
        passType: booking.passType,
        qty: booking.quantity,
        subtotal: parseFloat(booking.subtotalAmount?.toString() || "0"),
        vat: parseFloat(booking.vatAmount?.toString() || "0"),
        total: parseFloat(booking.totalAmount?.toString() || "0"),
        paymentMethod: booking.paymentMethod || "",
        invoiceRef: booking.orderReference || "",
        billingName: booking.billingName || "",
        billingCompany: booking.billingCompany || "",
        billingEmail: booking.billingEmail || "",
        lead: a.isLead ? "★" : "",
        firstName: a.isTbc ? "(TBC)" : (a.firstName || ""),
        lastName: a.isTbc ? "" : (a.lastName || ""),
        jobTitle: a.isTbc ? "" : (a.jobTitle || ""),
        company: a.isTbc ? "" : (a.company || ""),
        workEmail: a.isTbc ? "" : (a.workEmail || ""),
        phone: a.isTbc ? "" : (a.phone || ""),
        dietary: a.isTbc ? "" : (a.dietaryAccessibility || ""),
        gdpr: a.isTbc ? "" : (a.gdprConsent ? "Yes" : "No"),
        registeredAt: booking.createdAt.toISOString(),
      });
      if (a.isLead) {
        row.getCell("lead").font = { bold: true, color: { argb: "FFE74F3E" } };
      }
    }
  }

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFE5E7EB" } },
        left: { style: "thin", color: { argb: "FFE5E7EB" } },
        bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
        right: { style: "thin", color: { argb: "FFE5E7EB" } },
      };
    });
    if (rowNumber % 2 === 0) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
      });
    }
  });

  const date = new Date().toISOString().split("T")[0];
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="hras26-registrations-${date}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

router.get("/admin/registrations/:id", adminAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id));
  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
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

router.get("/admin/promo-codes", adminAuth, async (_req, res): Promise<void> => {
  const codes = await db.select().from(promoCodesTable).orderBy(desc(promoCodesTable.createdAt));
  res.json(codes.map(formatPromoCode));
});

router.post("/admin/promo-codes", adminAuth, async (req, res): Promise<void> => {
  const { code, discountType, discountValue, maxUses, validFrom, validUntil, isActive, description } = req.body;

  if (!code || !discountType || discountValue === undefined) {
    res.status(400).json({ error: "code, discountType, and discountValue are required" });
    return;
  }

  const [promo] = await db
    .insert(promoCodesTable)
    .values({
      code: (code as string).toUpperCase(),
      discountType,
      discountValue: discountValue.toString(),
      maxUses: maxUses || null,
      validFrom: validFrom ? new Date(validFrom) : null,
      validUntil: validUntil ? new Date(validUntil) : null,
      isActive: isActive !== false,
      description: description || null,
    })
    .returning();

  res.status(201).json(formatPromoCode(promo));
});

router.patch("/admin/promo-codes/:id", adminAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const [existing] = await db.select().from(promoCodesTable).where(eq(promoCodesTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Promo code not found" });
    return;
  }

  const { code, discountType, discountValue, maxUses, validFrom, validUntil, isActive, description } = req.body;

  const updateData: Partial<typeof promoCodesTable.$inferInsert> = {};
  if (code !== undefined) updateData.code = (code as string).toUpperCase();
  if (discountType !== undefined) updateData.discountType = discountType;
  if (discountValue !== undefined) updateData.discountValue = discountValue.toString();
  if (maxUses !== undefined) updateData.maxUses = maxUses;
  if (validFrom !== undefined) updateData.validFrom = validFrom ? new Date(validFrom) : null;
  if (validUntil !== undefined) updateData.validUntil = validUntil ? new Date(validUntil) : null;
  if (isActive !== undefined) updateData.isActive = isActive;
  if (description !== undefined) updateData.description = description;

  const [updated] = await db
    .update(promoCodesTable)
    .set(updateData)
    .where(eq(promoCodesTable.id, id))
    .returning();

  res.json(formatPromoCode(updated));
});

router.delete("/admin/promo-codes/:id", adminAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const [existing] = await db.select().from(promoCodesTable).where(eq(promoCodesTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Promo code not found" });
    return;
  }

  await db.delete(promoCodesTable).where(eq(promoCodesTable.id, id));
  res.sendStatus(204);
});

router.put("/admin/discount-tiers", adminAuth, async (req, res): Promise<void> => {
  const { passType, tiers } = req.body;

  if (!passType || !Array.isArray(tiers)) {
    res.status(400).json({ error: "passType and tiers array are required" });
    return;
  }

  await db.delete(discountTiersTable).where(eq(discountTiersTable.passType, passType));

  const inserted = await db
    .insert(discountTiersTable)
    .values(
      tiers.map((tier: { minQuantity: number; discountPercent: number; label?: string }) => ({
        passType,
        minQuantity: tier.minQuantity,
        discountPercent: tier.discountPercent.toString(),
        label: tier.label || null,
      }))
    )
    .returning();

  res.json(inserted.map(formatTier));
});

router.get("/admin/passes/inventory", adminAuth, async (_req, res): Promise<void> => {
  const rows = await db.select().from(passInventoryTable);
  res.json(rows);
});

router.put("/admin/passes/inventory/:passType", adminAuth, async (req, res): Promise<void> => {
  const passType = req.params["passType"] as string;
  if (!["single", "business"].includes(passType)) {
    res.status(400).json({ error: "Invalid pass type" });
    return;
  }
  const { remaining } = req.body;
  const val = remaining === null || remaining === "" ? null : parseInt(remaining, 10);
  if (val !== null && (isNaN(val) || val < 0)) {
    res.status(400).json({ error: "remaining must be a non-negative integer or null" });
    return;
  }
  await db
    .insert(passInventoryTable)
    .values({ passType, remaining: val, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: passInventoryTable.passType,
      set: { remaining: val, updatedAt: new Date() },
    });
  const [row] = await db.select().from(passInventoryTable).where(eq(passInventoryTable.passType, passType));
  res.json(row);
});

router.get("/admin/notification-emails", adminAuth, async (_req, res): Promise<void> => {
  const emails = await db
    .select()
    .from(notificationEmailsTable)
    .orderBy(notificationEmailsTable.createdAt);
  res.json(emails.map(e => ({
    ...e,
    createdAt: e.createdAt.toISOString(),
  })));
});

router.post("/admin/notification-emails", adminAuth, async (req, res): Promise<void> => {
  const { email, label } = req.body;
  if (!email || typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "A valid email address is required" });
    return;
  }
  try {
    const [inserted] = await db
      .insert(notificationEmailsTable)
      .values({ email: email.trim().toLowerCase(), label: label?.trim() || null })
      .returning();
    res.status(201).json({ ...inserted, createdAt: inserted.createdAt.toISOString() });
  } catch {
    res.status(409).json({ error: "This email address is already in the list" });
  }
});

router.delete("/admin/notification-emails/:id", adminAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  await db.delete(notificationEmailsTable).where(eq(notificationEmailsTable.id, id));
  res.status(204).end();
});

export default router;
