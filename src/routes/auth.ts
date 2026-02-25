import { Router } from "express";
import { z } from "zod";
import { createVerificationToken, sendMagicLink, signToken, useVerificationToken, verifyToken } from "../auth";
import { prisma } from "../prisma";

const router = Router();

const emailSchema = z.string().email();

router.post("/request", async (req, res) => {
  const rawEmail = typeof req.body?.email === "string" ? req.body.email : "";
  const email = rawEmail.trim().toLowerCase();
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid email" });
  }

  try {
    const { token } = await createVerificationToken(parsed.data);
    const appUrl = process.env.APP_URL;
    if (!appUrl) {
      return res.status(500).json({ error: "APP_URL is not configured on the backend." });
    }
    const link = `${appUrl}/auth/callback?token=${token}&email=${encodeURIComponent(parsed.data)}`;

    await sendMagicLink(parsed.data, link);
    return res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[auth/request] failed:", message);
    return res.status(500).json({ error: message });
  }
});

router.post("/verify", async (req, res) => {
  const parsed = z.object({ email: z.string().email(), token: z.string() }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const email = parsed.data.email.toLowerCase();
  const record = await useVerificationToken(email, parsed.data.token);
  if (!record) {
    return res.status(400).json({ error: "Invalid or expired token" });
  }

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, emailVerified: new Date() },
    });
  } else if (!user.emailVerified) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: new Date() },
    });
  }

  const jwt = signToken(user.id);
  const secure = process.env.COOKIE_SECURE === "1";
  res.cookie("auth_token", jwt, {
    httpOnly: true,
    secure,
    sameSite: secure ? "none" : "lax",
    maxAge: 1000 * 60 * 60 * 24 * 30,
    path: "/",
  });

  return res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
});

router.post("/logout", async (_req, res) => {
  res.clearCookie("auth_token");
  return res.json({ ok: true });
});

router.get("/me", async (req, res) => {
  const token = req.cookies?.auth_token;
  if (!token) return res.status(401).json({ error: "Please sign in first." });
  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return res.status(401).json({ error: "Please sign in first." });
    return res.json({ id: user.id, email: user.email, name: user.name });
  } catch {
    return res.status(401).json({ error: "Please sign in first." });
  }
});

router.put("/me", async (req, res) => {
  const token = req.cookies?.auth_token;
  if (!token) return res.status(401).json({ error: "Please sign in first." });
  const parsed = z.object({ name: z.string().min(2).max(60) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid name" });
  try {
    const payload = verifyToken(token);
    const user = await prisma.user.update({
      where: { id: payload.sub },
      data: { name: parsed.data.name.trim() },
    });
    return res.json({ id: user.id, email: user.email, name: user.name });
  } catch {
    return res.status(401).json({ error: "Please sign in first." });
  }
});

export default router;
