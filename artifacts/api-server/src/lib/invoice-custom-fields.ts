export function buildStripeInvoiceCustomFields(
  orderRef: string,
  poNumber?: string | null,
): Array<{ name: string; value: string }> {
  const fields = [
    { name: "Booking reference", value: orderRef },
    { name: "Company Number", value: "12252258" },
    { name: "VAT Number", value: "336124621" },
  ];
  if (poNumber) {
    fields.push({ name: "PO Number", value: poNumber.slice(0, 30) });
  } else {
    fields.push({ name: "Contact", value: "douglas@dynamicbusinessleaders.co.uk" });
  }
  return fields;
}
