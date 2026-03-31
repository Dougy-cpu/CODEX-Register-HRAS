/**
 * Shared FreeAgent client helpers.
 * Keeping this separate from the route file avoids circular imports
 * when email.ts needs to download FA invoice PDFs.
 */
import axios from "axios";
import { db } from "@workspace/db";
import { eventSettingsTable } from "@workspace/db";
import { logger } from "./logger";

const FREEAGENT_BASE = "https://api.freeagent.com/v2";

interface FreeAgentTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export async function getFreeAgentToken(): Promise<string | null> {
  const clientId = process.env.FREEAGENT_CLIENT_ID;
  const clientSecret = process.env.FREEAGENT_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;

  const [settings] = await db.select().from(eventSettingsTable);
  if (settings?.freeagentAccessToken && settings.freeagentTokenExpiresAt) {
    const expiresAt = new Date(settings.freeagentTokenExpiresAt).getTime();
    if (expiresAt - Date.now() > 5 * 60 * 1000) {
      return settings.freeagentAccessToken;
    }
  }

  const refreshToken = settings?.freeagentRefreshToken || process.env.FREEAGENT_REFRESH_TOKEN;
  if (!refreshToken) return null;

  try {
    const response = await axios.post<FreeAgentTokenResponse>(
      `${FREEAGENT_BASE}/token_endpoint`,
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        auth: { username: clientId, password: clientSecret },
      }
    );

    const { access_token, refresh_token: newRefreshToken, expires_in = 3600 } = response.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    if (settings) {
      await db.update(eventSettingsTable).set({
        freeagentAccessToken: access_token,
        freeagentRefreshToken: newRefreshToken || refreshToken,
        freeagentTokenExpiresAt: expiresAt,
      });
    } else {
      await db.insert(eventSettingsTable).values({
        freeagentAccessToken: access_token,
        freeagentRefreshToken: newRefreshToken || refreshToken,
        freeagentTokenExpiresAt: expiresAt,
      });
    }

    logger.info("FreeAgent access token refreshed");
    return access_token;
  } catch (err) {
    logger.error({ err }, "Failed to get FreeAgent token");
    return null;
  }
}

const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF

function isValidPdf(buf: Buffer): boolean {
  return buf.length > 1024 && buf.slice(0, 4).equals(PDF_MAGIC);
}

/**
 * Download a FreeAgent invoice as a PDF buffer.
 * Retries once with a 3-second delay if the first attempt returns an invalid PDF
 * (FreeAgent sometimes needs a moment after marking an invoice as Sent).
 * @param invoiceApiUrl e.g. "https://api.freeagent.com/v2/invoices/12345"
 */
export async function downloadFreeAgentInvoicePdf(
  invoiceApiUrl: string,
  token: string
): Promise<Buffer | null> {
  const baseUrl = invoiceApiUrl.replace(/\/?$/, "");

  async function attempt(): Promise<Buffer | null> {
    try {
      // FreeAgent serves invoice PDFs at the base URL with a .pdf suffix.
      const pdfUrl = baseUrl + ".pdf";
      const resp = await axios.get<ArrayBuffer>(pdfUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/pdf" },
        responseType: "arraybuffer",
        maxRedirects: 5,
      });
      const buf = Buffer.from(resp.data);
      if (!isValidPdf(buf)) {
        logger.warn({ url: baseUrl, size: buf.length }, "FreeAgent PDF response does not look like a valid PDF");
        return null;
      }
      return buf;
    } catch (err) {
      logger.error({ err }, "Failed to download FreeAgent invoice PDF");
      return null;
    }
  }

  // First attempt
  const first = await attempt();
  if (first) return first;

  // Retry after a short delay — FreeAgent may need time to generate the PDF
  logger.info("Retrying FreeAgent PDF download after 3s delay…");
  await new Promise(r => setTimeout(r, 3000));
  return attempt();
}
