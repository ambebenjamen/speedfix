import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../auth";

export type AuthedRequest = Request & { userId?: string };

export const requireAuth = (req: AuthedRequest, res: Response, next: NextFunction) => {
  const token = req.cookies?.auth_token;
  if (!token) {
    return res.status(401).json({ error: "Please sign in first." });
  }
  try {
    const payload = verifyToken(token);
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "Please sign in first." });
  }
};
