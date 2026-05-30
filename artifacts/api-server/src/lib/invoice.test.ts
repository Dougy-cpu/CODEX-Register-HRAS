import { describe, expect, it } from "vitest";
import { buildStripeInvoiceCustomFields } from "./invoice-custom-fields";

describe("buildStripeInvoiceCustomFields", () => {
  it("includes the HRAS booking reference as a visible Stripe invoice custom field", () => {
    const fields = buildStripeInvoiceCustomFields("HRAS26-6544", null);

    expect(fields).toContainEqual({ name: "Booking reference", value: "HRAS26-6544" });
    expect(fields).toContainEqual({ name: "Company Number", value: "12252258" });
    expect(fields).toContainEqual({ name: "VAT Number", value: "336124621" });
    expect(fields).toContainEqual({
      name: "Contact",
      value: "douglas@dynamicbusinessleaders.co.uk",
    });
    expect(fields).toHaveLength(4);
  });

  it("preserves the PO custom field when one is supplied", () => {
    const fields = buildStripeInvoiceCustomFields("HRAS26-6544", "PO-2026-1234567890");

    expect(fields).toContainEqual({ name: "Booking reference", value: "HRAS26-6544" });
    expect(fields).toContainEqual({ name: "PO Number", value: "PO-2026-1234567890" });
    expect(fields.some((field) => field.name === "Contact")).toBe(false);
    expect(fields).toHaveLength(4);
  });

  it("keeps Stripe custom field values within Stripe's visible field limit", () => {
    const fields = buildStripeInvoiceCustomFields(
      "HRAS26-6544",
      "PO-1234567890-1234567890-1234567890",
    );

    expect(fields.find((field) => field.name === "PO Number")?.value).toHaveLength(30);
  });
});
