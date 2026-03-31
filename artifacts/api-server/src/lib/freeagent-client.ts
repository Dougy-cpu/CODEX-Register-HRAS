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

/**
 * Download a FreeAgent invoice as a PDF buffer.
 * @param invoiceApiUrl e.g. "https://api.freeagent.com/v2/invoices/12345"
 */
export async function downloadFreeAgentInvoicePdf(
  invoiceApiUrl: string,
  token: string
): Promise<Buffer | null> {
  try {
    const pdfUrl = invoiceApiUrl.replace(/\/?$/, "") + ".pdf";
    const resp = await axios.get<ArrayBuffer>(pdfUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/pdf" },
      responseType: "arraybuffer",
    });
    return Buffer.from(resp.data);
  } catch (err) {
    logger.error({ err }, "Failed to download FreeAgent invoice PDF");
    return null;
  }
}
