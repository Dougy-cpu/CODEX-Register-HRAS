import { Request, Response, NextFunction } from "express";
import { createHmac } from "crypto";

const HMAC_SALT = "hrs-admin-token-v1";

const BLOCKED_PASSWORDS = new Set(["admin123", "admin", "password", "123456", "secret"]);

export function deriveAdminToken(password: string): string {
  return createHmac("sha256", password).update(HMAC_SALT).digest("hex");
}

export function getAdminPassword(): string | null {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  if (BLOCKED_PASSWORDS.has(pw)) return null;
  return pw;
}

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const adminPassword = getAdminPassword();

  if (!adminPassword) {
    res
      .status(503)
      .json({ error: "Admin authentication not configured — set a secure ADMIN_PASSWORD" });
    return;
  }

  const token = req.headers["x-admin-token"] as string | undefined;
  const expectedToken = deriveAdminToken(adminPassword);

  if (!token || token !== expectedToken) {
    res.status(401).json({ error: "Unauthorized — invalid admin token" });
    return;
  }

  next();
}
