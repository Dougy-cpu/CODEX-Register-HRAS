import { Request, Response, NextFunction } from "express";

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers["x-admin-token"] as string;
  const adminToken = process.env.ADMIN_TOKEN;

  if (!adminToken) {
    next();
    return;
  }

  if (!token || token !== adminToken) {
    res.status(401).json({ error: "Unauthorized — invalid admin token" });
    return;
  }

  next();
}
