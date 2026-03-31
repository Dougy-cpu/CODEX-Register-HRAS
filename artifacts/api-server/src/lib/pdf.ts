import PDFDocument from "pdfkit";

interface BookingForPdf {
  id: number;
  orderReference: string | null;
  passType: string;
  quantity: number;
  subtotalAmount: string | null;
  vatAmount: string | null;
  totalAmount: string | null;
  promoCode: string | null;
  promoDiscountAmount: string | null;
  groupDiscountAmount: string | null;
  billingName: string | null;
  billingCompany: string | null;
  billingEmail: string | null;
  billingAddress: string | null;
  createdAt: Date;
}

interface AttendeeForPdf {
  firstName: string;
  lastName: string;
  company: string;
  workEmail: string;
  isLead: boolean;
}

const passLabels: Record<string, string> = {
  single: "Single Pass — HR Analytics Summit",
  team: "Team Pass (3 Seats) — HR Analytics Summit",
  business: "Business Pass — HR Analytics Summit",
};

const PASS_PRICES: Record<string, number> = {
  single: 199,
  team: 499,
  business: 599,
};

export function generatePdfReceipt(
  booking: BookingForPdf,
  attendees: AttendeeForPdf[]
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const formatCurrency = (n: number) =>
      `£${n.toFixed(2)}`;

    const lead = attendees.find((a) => a.isLead) || attendees[0];
    const dateStr = new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const subtotal = parseFloat(booking.subtotalAmount?.toString() || "0");
    const vat = parseFloat(booking.vatAmount?.toString() || "0");
    const total = parseFloat(booking.totalAmount?.toString() || "0");
    const promoDiscount = parseFloat(booking.promoDiscountAmount?.toString() || "0");
    const groupDiscount = parseFloat(booking.groupDiscountAmount?.toString() || "0");
    const pricePerHead = PASS_PRICES[booking.passType] || 0;

    doc
      .fontSize(22)
      .fillColor("#E74F3E")
      .text("HR Analytics Summit", { align: "left" });

    doc
      .fontSize(11)
      .fillColor("#666")
      .text("3 September 2026 · 155 Bishopsgate, London EC2M 3TQ", { align: "left" });

    doc.moveDown(0.5);

    doc
      .moveTo(50, doc.y)
      .lineTo(545, doc.y)
      .strokeColor("#E74F3E")
      .lineWidth(2)
      .stroke();

    doc.moveDown(1);

    doc
      .fontSize(18)
      .fillColor("#000")
      .text("VAT Receipt", { align: "left" });

    doc.moveDown(0.5);
    doc.fontSize(11).fillColor("#333");
    doc.text(`Receipt Number: ${booking.orderReference || `INV-${booking.id}`}`);
    doc.text(`Date: ${dateStr}`);
    doc.text(`Booking Reference: ${booking.orderReference || `#${booking.id}`}`);

    doc.moveDown(1);

    doc.fontSize(12).fillColor("#000").text("Bill To:", { underline: true });
    doc.fontSize(11).fillColor("#333");
    if (booking.billingName || lead) {
      doc.text(booking.billingName || `${lead?.firstName} ${lead?.lastName}` || "");
    }
    if (booking.billingCompany || lead?.company) {
      doc.text(booking.billingCompany || lead?.company || "");
    }
    if (booking.billingEmail || lead?.workEmail) {
      doc.text(booking.billingEmail || lead?.workEmail || "");
    }
    if (booking.billingAddress) {
      doc.text(booking.billingAddress);
    }

    doc.moveDown(1.5);

    doc
      .moveTo(50, doc.y)
      .lineTo(545, doc.y)
      .strokeColor("#ddd")
      .lineWidth(1)
      .stroke();

    const tableTop = doc.y + 10;
    doc
      .fontSize(11)
      .fillColor("#666")
      .text("Description", 50, tableTop)
      .text("Qty", 370, tableTop, { width: 50, align: "right" })
      .text("Unit Price", 420, tableTop, { width: 70, align: "right" })
      .text("Amount", 490, tableTop, { width: 55, align: "right" });

    doc
      .moveTo(50, tableTop + 18)
      .lineTo(545, tableTop + 18)
      .strokeColor("#ddd")
      .lineWidth(1)
      .stroke();

    let rowY = tableTop + 26;

    doc
      .fontSize(11)
      .fillColor("#000")
      .text(passLabels[booking.passType] || booking.passType, 50, rowY, { width: 310 })
      .text(String(booking.quantity), 370, rowY, { width: 50, align: "right" })
      .text(formatCurrency(pricePerHead), 420, rowY, { width: 70, align: "right" })
      .text(formatCurrency(pricePerHead * booking.quantity), 490, rowY, { width: 55, align: "right" });

    rowY += 24;

    if (groupDiscount > 0) {
      doc
        .fontSize(11)
        .fillColor("#333")
        .text("Group Discount", 50, rowY)
        .text("", 370, rowY, { width: 50, align: "right" })
        .text("", 420, rowY, { width: 70, align: "right" })
        .text(`-${formatCurrency(groupDiscount)}`, 490, rowY, { width: 55, align: "right" });
      rowY += 24;
    }

    if (promoDiscount > 0) {
      doc
        .fontSize(11)
        .fillColor("#333")
        .text(`Promo Code (${booking.promoCode})`, 50, rowY)
        .text(`-${formatCurrency(promoDiscount)}`, 490, rowY, { width: 55, align: "right" });
      rowY += 24;
    }

    doc
      .moveTo(50, rowY)
      .lineTo(545, rowY)
      .strokeColor("#ddd")
      .lineWidth(1)
      .stroke();

    rowY += 10;

    doc
      .fontSize(11)
      .fillColor("#333")
      .text("Subtotal (excl. VAT)", 50, rowY)
      .text(formatCurrency(subtotal - groupDiscount - promoDiscount), 490, rowY, { width: 55, align: "right" });

    rowY += 20;

    doc
      .text("VAT (20%)", 50, rowY)
      .text(formatCurrency(vat), 490, rowY, { width: 55, align: "right" });

    rowY += 20;

    doc
      .moveTo(390, rowY)
      .lineTo(545, rowY)
      .strokeColor("#000")
      .lineWidth(1.5)
      .stroke();

    rowY += 8;

    doc
      .fontSize(14)
      .fillColor("#000")
      .text("Total (incl. VAT)", 50, rowY)
      .text(formatCurrency(total), 490, rowY, { width: 55, align: "right" });

    rowY += 40;

    doc.fontSize(10).fillColor("#555");
    doc.text(
      "This document serves as a VAT receipt. VAT Registration: Please contact us for VAT details.",
      50,
      rowY
    );

    rowY += 30;
    doc
      .moveTo(50, rowY)
      .lineTo(545, rowY)
      .strokeColor("#eee")
      .lineWidth(1)
      .stroke();

    rowY += 20;
    doc.fontSize(10).fillColor("#888");
    doc.text("HR Analytics Summit · People Strategy Hub Ltd", 50, rowY, { align: "center" });
    rowY += 14;
    doc.text(
      "155 Bishopsgate, London EC2M 3TQ · info@hranalyticssummit.com · www.hranalyticssummit.com",
      50,
      rowY,
      { align: "center" }
    );

    doc.end();
  });
}
