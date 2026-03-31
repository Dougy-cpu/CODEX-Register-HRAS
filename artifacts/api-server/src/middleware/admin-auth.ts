import { Request, Response, NextFunction } from "express";
import { createHmac } from "crypto";

const HMAC_SALT = "hrs-admin-token-v1";

export function deriveAdminToken(password: string): string {
  return createHmac("sha256", password).update(HMAC_SALT).digest("hex");
}

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const adminPassword = process.env.ADMIN_PASSWORD;

  // In production, admin access is disabled if ADMIN_PASSWORD is not configured.
  if (!adminPassword && process.env.NODE_ENV === "production") {
    res.status(503).json({ error: "Admin authentication not configured — set ADMIN_PASSWORD" });
    return;
  }

  const token = req.headers["x-admin-token"] as string | undefined;
  const effectivePassword = adminPassword || "admin123";
  const expectedToken = deriveAdminToken(effectivePassword);

  if (!token || token !== expectedToken) {
    res.status(401).json({ error: "Unauthorized — invalid admin token" });
    return;
  }

  next();
}
