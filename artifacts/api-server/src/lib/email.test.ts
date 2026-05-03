import { describe, it, expect } from "vitest";
import { escHtml } from "./email";

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
