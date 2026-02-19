import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";

const router = Router();

const getOwnerEmail = () => (process.env.ADMIN_EMAIL ?? "").toLowerCase();

const ensureOwner = async (req: AuthedRequest, res: any, next: any) => {
  const ownerEmail = getOwnerEmail();
  if (!ownerEmail) {
    return res.status(500).json({ error: "Admin access is not configured." });
  }
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user || user.email.toLowerCase() !== ownerEmail) {
    return res.status(403).json({ error: "Forbidden: owner only." });
  }
  next();
};

router.use(requireAuth, ensureOwner);

router.get("/users", async (_req, res) => {
  const users = await prisma.user.findMany({
    include: { scans: true },
    orderBy: { createdAt: "desc" },
  });
  const payload = users.map((user: any) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    suspended: user.suspended ?? false,
    deleted: user.deleted ?? false,
    scanCount: user.scans.length,
  }));
  return res.json(payload);
});

// New route: Get all users with active pro or higher subscriptions
router.get("/pro-users", async (_req, res) => {
  // Find all subscriptions with status active or trialing and plan pro or higher
  const proSubscriptions = await prisma.subscription.findMany({
    where: {
      status: { in: ["active", "trialing"] },
      OR: [
        { plan: "pro" },
        { plan: "business" },
        { plan: "enterprise" },
      ],
    },
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });
  const payload = proSubscriptions.map((sub: any) => ({
    id: sub.user.id,
    email: sub.user.email,
    name: sub.user.name,
    plan: sub.plan,
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
    createdAt: sub.user.createdAt,
  }));
  return res.json(payload);
});

router.put("/users/:id", async (req, res) => {
  const parsed = z
    .object({ action: z.enum(["suspend", "delete"]) })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request." });
  }
  const userId = req.params.id;
  const updateData =
    parsed.data.action === "suspend" ? { suspended: true } : { deleted: true };
  await prisma.user.update({ where: { id: userId }, data: updateData });
  return res.json({ ok: true });
});

export default router;
