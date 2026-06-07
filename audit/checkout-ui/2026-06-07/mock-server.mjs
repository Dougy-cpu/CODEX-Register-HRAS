import http from "node:http";

const port = Number(process.env.AUDIT_PORT || 5192);
const vitePort = Number(process.env.VITE_PORT || 5182);

const attendee = (overrides = {}) => ({
  id: 1,
  bookingId: 101,
  isLead: true,
  firstName: "Douglas",
  lastName: "Leach",
  jobTitle: "Global Head of L&D Strategy",
  company: "People Strategy Hub",
  workEmail: "douglas@example.com",
  phone: "+44 7700 900077",
  isTbc: false,
  gdprConsent: true,
  gdprConsentAt: "2026-06-07T09:00:00.000Z",
  dietaryAccessibility: null,
  seatIndex: 0,
  createdAt: "2026-06-07T09:00:00.000Z",
  updatedAt: "2026-06-07T09:00:00.000Z",
  ...overrides,
});

function getAuditState(req) {
  const referer = req.headers.referer || `http://127.0.0.1:${port}/`;
  const url = new URL(referer);
  const requestedQuantity = Number(url.searchParams.get("quantity") || 0);
  return {
    step: Math.min(5, Math.max(1, Number(url.searchParams.get("auditStep") || 2))),
    attendeeType:
      url.searchParams.get("audience") === "vendor" ? "consultant_vendor" : "hr_professional",
    paymentMethod: url.searchParams.get("payment") === "card" ? "card" : "invoice",
    tbc: url.searchParams.get("tbc") === "1",
    empty: url.searchParams.get("empty") === "1",
    quantity: requestedQuantity > 0 ? requestedQuantity : 0,
  };
}

function bookingFor(req) {
  const state = getAuditState(req);
  const isVendor = state.attendeeType === "consultant_vendor";
  const quantity = state.quantity || (isVendor ? 2 : 3);
  const total = isVendor ? 1437.6 : 608.94;
  const attendees = state.empty
    ? []
    : [
        attendee(),
        attendee({
          id: 2,
          isLead: false,
          firstName: "Alex",
          lastName: "Morgan",
          workEmail: "alex@example.com",
          phone: null,
          seatIndex: 1,
        }),
        attendee({
          id: 3,
          isLead: false,
          firstName: state.tbc ? null : "TBC",
          lastName: state.tbc ? null : "Attendee",
          jobTitle: state.tbc ? "TBC" : "People Director",
          company: state.tbc ? "TBC" : "Example Company",
          workEmail: state.tbc ? "" : "attendee@example.com",
          phone: null,
          isTbc: state.tbc,
          gdprConsent: false,
          seatIndex: 2,
        }),
      ].slice(0, quantity);

  return {
    id: 101,
    sessionToken: "audit-session",
    status:
      state.step === 5 ? (state.paymentMethod === "invoice" ? "invoiced" : "paid") : "partial",
    passType: isVendor ? "business" : "single",
    attendeeType: state.attendeeType,
    quantity,
    promoCode: null,
    promoDiscountAmount: 0,
    groupDiscountAmount: isVendor ? 0 : 89.55,
    subtotalAmount: isVendor ? 1198 : 507.45,
    vatAmount: isVendor ? 239.6 : 101.49,
    totalAmount: total,
    paymentMethod: state.step >= 4 ? state.paymentMethod : null,
    stripeSessionId: null,
    stripePaymentIntentId: null,
    stripeInvoiceId: state.paymentMethod === "invoice" ? "in_audit" : null,
    stripeInvoicePdfUrl: null,
    stripeInvoicePaymentUrl:
      state.paymentMethod === "invoice" ? "https://invoice.stripe.com/example" : null,
    orderReference: "HRAS26-6628",
    currentStep: state.step,
    billingName: "Douglas Leach",
    billingCompany: "People Strategy Hub",
    billingEmail: "douglas@example.com",
    billingAddress: null,
    billingAddressLine1: "155 Bishopsgate",
    billingAddressLine2: "",
    billingTown: "London",
    billingRegion: "",
    billingPostcode: "EC2M 3YD",
    billingCountry: "United Kingdom",
    billingVatNumber: "GB123456789",
    billingPhone: "+44 7700 900077",
    poNumber: "",
    managementToken: "audit-management-token",
    invoiceDueDate: "2026-06-21T09:00:00.000Z",
    paidAt: state.paymentMethod === "card" ? "2026-06-07T10:00:00.000Z" : null,
    stripeInvoiceStatus: state.paymentMethod === "invoice" ? "open" : null,
    stripeInvoiceStatusSyncedAt: null,
    invoiceBadgeStatus: state.paymentMethod === "invoice" ? "sent" : undefined,
    confirmationEmailSent: true,
    welcomeEmailsSent: true,
    organiserNotified: true,
    sheetsSynced: true,
    needsAttention: false,
    createdAt: "2026-06-07T09:00:00.000Z",
    updatedAt: "2026-06-07T10:00:00.000Z",
    attendees,
  };
}

function pricingFor(req, body) {
  const parsed = body ? JSON.parse(body) : {};
  const state = getAuditState(req);
  const passType =
    parsed.passType || (state.attendeeType === "consultant_vendor" ? "business" : "single");
  const quantity = Number(parsed.quantity || (passType === "business" ? 2 : 3));
  const pricePerHead = passType === "business" ? 599 : 199;
  const baseSubtotal = quantity * pricePerHead;
  const groupDiscountPercent = passType === "single" && quantity >= 3 ? 15 : 0;
  const groupDiscountAmount = (baseSubtotal * groupDiscountPercent) / 100;
  const subtotalAfterDiscounts = baseSubtotal - groupDiscountAmount;
  const vatAmount = subtotalAfterDiscounts * 0.2;
  return {
    passType,
    quantity,
    pricePerHead,
    baseSubtotal,
    groupDiscountPercent,
    groupDiscountAmount,
    promoDiscountAmount: 0,
    subtotalAfterDiscounts,
    vatRate: 20,
    vatAmount,
    total: subtotalAfterDiscounts + vatAmount,
    originalPrice: quantity * (passType === "business" ? 999 : 429),
    savedAmount: quantity * (passType === "business" ? 999 : 429) - subtotalAfterDiscounts,
    promoDiscountType: null,
    promoRemainingSeats: null,
  };
}

function sendJson(res, value, status = 200) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function handleApi(req, res, requestBody) {
  if (/^\/api\/bookings\/by-session\//.test(req.url)) {
    return sendJson(res, bookingFor(req));
  }
  if (req.url === "/api/pricing/calculate") {
    return sendJson(res, pricingFor(req, requestBody));
  }
  if (req.url === "/api/discount-tiers") {
    return sendJson(res, [
      { id: 1, passType: "single", minQuantity: 3, discountPercent: 15, label: "Team rate" },
      { id: 2, passType: "single", minQuantity: 5, discountPercent: 20, label: "Group rate" },
      { id: 3, passType: "business", minQuantity: 3, discountPercent: 10, label: "Team rate" },
      { id: 4, passType: "business", minQuantity: 5, discountPercent: 15, label: "Group rate" },
    ]);
  }
  if (req.url === "/api/passes/inventory") {
    return sendJson(res, { single: 48, business: 12 });
  }
  if (req.url === "/api/passes/config") {
    return sendJson(res, {
      single: {
        currentPrice: "199",
        originalPrice: "429",
        pricingPeriodName: "Early Bird",
        benefits: [
          "Full summit access",
          "Networking and refreshments",
          "Post-event session resources",
          "Certificate of attendance",
        ],
        extraBenefits: [],
      },
      business: {
        currentPrice: "599",
        originalPrice: "999",
        pricingPeriodName: "Early Bird",
        benefits: ["Full summit access", "Networking and refreshments"],
        extraBenefits: ["Consultant and vendor access", "Commercial networking opportunities"],
      },
    });
  }
  if (req.url === "/api/hear-about-us-options") {
    return sendJson(res, [
      { label: "LinkedIn" },
      { label: "Email" },
      { label: "Colleague recommendation" },
    ]);
  }
  if (req.url === "/api/event-settings/public") {
    return sendJson(res, {
      invoiceHelpContent:
        "Need more detail?\nThe billing contact receives secure links to pay and update invoice details.",
    });
  }
  if (req.method === "PATCH" || req.method === "POST") {
    return sendJson(res, bookingFor(req));
  }
  return sendJson(res, {});
}

function proxyToVite(req, res) {
  const proxy = http.request(
    {
      hostname: "127.0.0.1",
      port: vitePort,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${vitePort}` },
    },
    (upstream) => {
      const contentType = String(upstream.headers["content-type"] || "");
      if (!contentType.includes("text/html")) {
        res.writeHead(upstream.statusCode || 500, upstream.headers);
        upstream.pipe(res);
        return;
      }

      let body = "";
      upstream.setEncoding("utf8");
      upstream.on("data", (chunk) => {
        body += chunk;
      });
      upstream.on("end", () => {
        const auditTailwind = `
          <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
          <style type="text/tailwindcss">
            @theme inline {
              --color-background: hsl(var(--background));
              --color-foreground: hsl(var(--foreground));
              --color-border: hsl(var(--border));
              --color-input: hsl(var(--input));
              --color-ring: hsl(var(--ring));
              --color-card: hsl(var(--card));
              --color-card-foreground: hsl(var(--card-foreground));
              --color-primary: hsl(var(--primary));
              --color-primary-foreground: hsl(var(--primary-foreground));
              --color-secondary: hsl(var(--secondary));
              --color-secondary-foreground: hsl(var(--secondary-foreground));
              --color-muted: hsl(var(--muted));
              --color-muted-foreground: hsl(var(--muted-foreground));
              --color-accent: hsl(var(--accent));
              --color-accent-foreground: hsl(var(--accent-foreground));
              --color-destructive: hsl(var(--destructive));
              --color-success: hsl(var(--success));
              --color-success-foreground: hsl(var(--success-foreground));
              --color-gold: hsl(var(--gold));
              --font-sans: var(--font-sans);
              --font-display: var(--font-display);
              --radius-sm: var(--radius);
              --radius-md: var(--radius);
              --radius-lg: var(--radius);
              --radius-xl: var(--radius);
            }
          </style>
          <style>
            .checkout-shell main > div {
              opacity: 1 !important;
              transform: none !important;
            }
          </style>
          <script>
            window.addEventListener("load", () => {
              const params = new URLSearchParams(window.location.search);
              if (params.get("auditPayment") !== "invoice") return;
              window.setTimeout(() => {
                const invoiceChoice = [...document.querySelectorAll("label")].find((label) =>
                  label.textContent.includes("Pay by invoice"),
                );
                invoiceChoice?.click();
              }, 800);
            });
          </script>`;
        const output = body.replace("</head>", `${auditTailwind}</head>`);
        const headers = { ...upstream.headers };
        delete headers["content-length"];
        headers["content-length"] = Buffer.byteLength(output);
        res.writeHead(upstream.statusCode || 500, headers);
        res.end(output);
      });
    },
  );
  proxy.on("error", (error) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`Audit proxy error: ${error.message}`);
  });
  req.pipe(proxy);
}

http
  .createServer((req, res) => {
    if (!req.url.startsWith("/api/")) {
      proxyToVite(req, res);
      return;
    }

    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => handleApi(req, res, body));
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`Checkout audit server: http://127.0.0.1:${port}`);
  });
