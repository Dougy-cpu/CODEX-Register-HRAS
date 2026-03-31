import { Request, Response, NextFunction } from "express";
import { createHmac } from "crypto";

const HMAC_SALT = "hrs-admin-token-v1";

export function deriveAdminToken(password: string): string {
  return createHmac("sha256", password).update(HMAC_SALT).digest("hex");
}

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers["x-admin-token"] as string | undefined;
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
  const expectedToken = deriveAdminToken(adminPassword);

  if (!token || token !== expectedToken) {
    res.status(401).json({ error: "Unauthorized — invalid admin token" });
    return;
  }

  next();
}
