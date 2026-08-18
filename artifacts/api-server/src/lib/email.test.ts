import { describe, it, expect } from "vitest";
import {
  DEFAULT_INVOICE_HELP_CONTENT,
  buildPriceSummaryTableHtml,
  escHtml,
  getCommunitySocialTemplateVars,
  renderAttendeeChangeTableHtml,
  renderInvoiceHelpHtml,
  wrapInBrandedLayout,
} from "./email";

const unsafePunctuationPattern = new RegExp(
  [0x2014, 0x2013, 0x2192, 0x2190, 0x00d7].map((code) => String.fromCharCode(code)).join("|"),
);
const mojibakePattern = new RegExp(
  [[0x00c3, 0x00a2], [0x00c3, 0x0192], [0x00c3, 0x201a], [0x00ef, 0x00bf, 0x00bd], [0xfffd]]
    .map((codes) => codes.map((code) => String.fromCharCode(code)).join(""))
    .join("|"),
);

describe("escHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escHtml(`<script>alert("xss")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;",
    );
    expect(escHtml("a & b")).toBe("a &amp; b");
    expect(escHtml("it's fine")).toBe("it&#39;s fine");
  });

  it("escapes ampersands first to avoid double-encoding", () => {
    expect(escHtml("&lt;")).toBe("&amp;lt;");
  });

  it("returns an empty string for null and undefined", () => {
    expect(escHtml(null)).toBe("");
    expect(escHtml(undefined)).toBe("");
  });

  it("coerces non-string values via String()", () => {
    expect(escHtml(42)).toBe("42");
    expect(escHtml(true)).toBe("true");
  });

  it("leaves benign user input untouched", () => {
    expect(escHtml("Acme Ltd")).toBe("Acme Ltd");
    expect(escHtml("Jane O Brien")).toBe("Jane O Brien");
  });

  it("neutralises an attribute-breaking payload", () => {
    // Simulates an attendee firstName trying to break out of an attribute
    // and inject an event handler.
    const payload = `" onmouseover="alert(1)`;
    const escaped = escHtml(payload);
    expect(escaped).not.toContain('"');
    expect(escaped).toContain("&quot;");
  });
});

/**
 * Renderer-path integration test.
 *
 * The production confirmation builder substitutes user-controlled values
 * into a stored HTML template by escaping each value with `escHtml` and
 * then doing `body.replaceAll(placeholder, escapedValue)`. We cannot
 * call `buildConfirmationEmailHtml` directly in a unit test because it
 * talks to the DB, so we replicate the exact substitution pattern here.
 */
describe("template substitution pattern (integration shape)", () => {
  it("escapes a malicious firstName when rendered into a template body", () => {
    const malicious = `<script>alert("pwned")</script>`;
    const template = `<h2>Welcome, {{firstName}}!</h2><p>Hi {{firstName}}.</p>`;

    const vars: Record<string, string> = {
      "{{firstName}}": escHtml(malicious),
    };

    let body = template;
    for (const [placeholder, value] of Object.entries(vars)) {
      body = body.replaceAll(placeholder, value);
    }

    expect(body).not.toContain("<script>");
    expect(body).not.toContain("</script>");
    expect(body).toContain("&lt;script&gt;");
    expect(body).toContain("&lt;/script&gt;");
    expect(body).toContain("&quot;pwned&quot;");
    expect(body).not.toContain("{{firstName}}");
  });

  it("escapes a billing-address payload that tries to inject an <img onerror>", () => {
    const malicious = `<img src=x onerror=alert(1)>`;
    const row = `<td>${escHtml(malicious)}</td>`;
    expect(row).toBe(`<td>&lt;img src=x onerror=alert(1)&gt;</td>`);
    expect(row).not.toContain("<img");
  });
});

describe("wrapInBrandedLayout", () => {
  it("renders uploaded logos with fixed email-safe dimensions", () => {
    const html = wrapInBrandedLayout("<p>Body</p>", {
      eventName: "HR Analytics Summit",
      logoDataUrl: "data:image/png;base64,abc123",
    });

    expect(html).toContain('width="96"');
    expect(html).toContain('height="96"');
    expect(html).toContain("width:96px!important");
    expect(html).toContain("height:96px!important");
    expect(html).toContain("max-width:96px!important");
    expect(html).toContain("max-height:96px!important");
    expect(html).toContain("display:block");
  });

  it("escapes logo attributes in the branded header", () => {
    const html = wrapInBrandedLayout("<p>Body</p>", {
      eventName: `HRAS "Summit"`,
      orgName: `People "Strategy" Hub`,
      logoDataUrl: `x" onerror="alert(1)`,
    });

    expect(html).toContain('alt="People &quot;Strategy&quot; Hub"');
    expect(html).not.toContain('onerror="alert(1)"');
  });
});

describe("buildPriceSummaryTableHtml", () => {
  it("renders email-safe rows with labels and values in separate table cells", () => {
    const html = buildPriceSummaryTableHtml([
      { label: "Subtotal (excl. VAT)", value: "GBP 507.45" },
      { label: "Group Discount", value: "-GBP 89.55", valueColor: "#E74F3E" },
      { label: "VAT (20%)", value: "GBP 101.49" },
      { label: "Total", value: "GBP 608.94", isTotal: true },
    ]);

    expect(html).toContain("<table");
    expect(html).toContain('role="presentation"');
    expect(html).toContain("Subtotal (excl. VAT):");
    expect(html).toContain("Group Discount:");
    expect(html).toContain("VAT (20%):");
    expect(html).toContain("Total:");
    expect(html).toContain("text-align:right");
    expect(html).not.toContain("display:flex");
    expect(html).not.toContain("price-row");
  });
});

describe("renderAttendeeChangeTableHtml", () => {
  it("renders an email-safe comparison table and escapes attendee-provided values", () => {
    const html = renderAttendeeChangeTableHtml([
      {
        field: "dietaryAccessibility",
        label: "Dietary / accessibility requirements",
        previous: "Vegetarian & step-free access",
        current: `<script>alert("unsafe")</script>`,
      },
    ]);

    expect(html).toContain('role="presentation"');
    expect(html).toContain("Previous details");
    expect(html).toContain("New details");
    expect(html).toContain("Vegetarian &amp; step-free access");
    expect(html).toContain("&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });
});

describe("Community Social email variables", () => {
  it("uses the HRAS social defaults and safely personalises the attendee name", () => {
    const settings = {
      id: 1,
      eventName: "HR Analytics Summit",
      eventStartAt: null,
      eventEndAt: null,
      eventTimezone: "Europe/London",
      eventDescription: null,
      eventVenue: "155 Bishopsgate, London",
      socialEnabled: false,
      socialName: null,
      socialStartAt: null,
      socialEndAt: null,
      socialVenue: null,
      socialDescription: null,
      orgWebsite: "https://www.hranalyticssummit.com",
      updatedAt: new Date(),
    } as Parameters<typeof getCommunitySocialTemplateVars>[0];

    const vars = getCommunitySocialTemplateVars(settings, `<Douglas>`);

    expect(vars["{{firstName}}"]).toBe("&lt;Douglas&gt;");
    expect(vars["{{socialName}}"]).toBe("HR Analytics Summit Community Social");
    expect(vars["{{socialVenue}}"]).toBe("Uncommon, 34-37 Liverpool Street, London EC2M 7PP");
    expect(vars["{{socialDate}}"]).toBe("Wednesday 2 September 2026");
    expect(vars["{{socialTime}}"]).toBe("6:00pm");
    expect(vars["{{socialDetailsUrl}}"]).toBe("https://www.hranalyticssummit.com/community-social");
    expect(vars["{{socialCalendarLinks}}"]).toBe("");
  });
});

describe("invoice help copy", () => {
  it("uses plain customer-facing punctuation", () => {
    expect(DEFAULT_INVOICE_HELP_CONTENT).not.toMatch(unsafePunctuationPattern);
    expect(DEFAULT_INVOICE_HELP_CONTENT).not.toMatch(mojibakePattern);
  });

  it("renders invoice help without unsafe punctuation", () => {
    const html = renderInvoiceHelpHtml(DEFAULT_INVOICE_HELP_CONTENT);
    expect(html).not.toMatch(unsafePunctuationPattern);
    expect(html).not.toMatch(mojibakePattern);
  });
});
