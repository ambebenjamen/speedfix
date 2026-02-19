import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { Prisma } from "@prisma/client";
import { runScan } from "../scan/runScan";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const router = Router();

const urlSchema = z.object({ url: z.string().min(3) });

const normalizeUrl = (raw: string) => {
  const trimmed = raw.trim();
  const url = trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
  new URL(url);
  return url;
};

router.post("/", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = urlSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid URL" });
  }

  // Check subscription status
  const subscription = await prisma.subscription.findUnique({
    where: { userId: req.userId! },
  });
  const isActive = subscription?.status === "active" || subscription?.status === "trialing";
  const plan = isActive ? subscription?.plan ?? "pro" : "free";

  if (plan === "free") {
    const existingScan = await prisma.scan.findFirst({
      where: { userId: req.userId! },
    });
    if (existingScan) {
      return res.status(403).json({ error: "Go Pro for more scanning and results." });
    }
  }

  let url: string;
  try {
    url = normalizeUrl(parsed.data.url);
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  const scan = await prisma.scan.create({
    data: {
      url,
      userId: req.userId!,
    },
  });

  try {
    const { summary, issues, raw } = await runScan(url);
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.issue.deleteMany({ where: { scanId: scan.id } });
      await tx.scan.update({
        where: { id: scan.id },
        data: {
          status: "COMPLETE",
          completedAt: new Date(),
          summaryJson: summary,
          rawJson: raw,
          issues: {
            createMany: {
              data: issues.map((issue) => ({
                title: issue.title,
                category: issue.category,
                severity: issue.severity,
                why: issue.why,
                how: issue.how,
                code: issue.code,
                impact: issue.impact,
              })),
            },
          },
        },
      });
    });
  } catch {
    await prisma.scan.update({
      where: { id: scan.id },
      data: { status: "FAILED" },
    });
    return res.status(500).json({ error: "Scan failed. Try again." });
  }

  return res.json({ scanId: scan.id });
});

router.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const scans = await prisma.scan.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return res.json(scans);
});

router.get("/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const scan = await prisma.scan.findUnique({
    where: { id },
    include: { issues: true },
  });
  if (!scan || scan.userId !== req.userId) {
    return res.status(404).json({ error: "Not found" });
  }

  const subscription = await prisma.subscription.findUnique({
    where: { userId: req.userId! },
  });
  const isActive =
    subscription?.status === "active" || subscription?.status === "trialing";
  const plan = isActive ? subscription?.plan ?? "pro" : "free";
  const limitIssues = plan === "free";
  const visibleIssues = limitIssues && scan.issues ? scan.issues.slice(0, 4) : scan.issues || [];
  const hiddenCount = limitIssues && scan.issues ? Math.max(scan.issues.length - 4, 0) : 0;

  return res.json({
    id: scan.id,
    url: scan.url,
    status: scan.status,
    createdAt: scan.createdAt,
    completedAt: scan.completedAt,
    summary: scan.summaryJson,
    issues: visibleIssues,
    plan,
    isLimited: limitIssues,
    hiddenCount,
  });
});

router.get("/:id/report", requireAuth, async (req: AuthedRequest, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const scan = await prisma.scan.findUnique({
    where: { id },
    include: { issues: true },
  });
  if (!scan || scan.userId !== req.userId) {
    return res.status(404).json({ error: "Not found" });
  }

  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const { width, height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  let cursorY = height - 48;
  const writeLine = (text: string, size = 12) => {
    page.drawText(text, {
      x: 48,
      y: cursorY,
      size,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
    cursorY -= size + 10;
  };

  writeLine("Website Speed & SEO Auto-Fix Report", 16);
  writeLine(`URL: ${scan.url}`);
  writeLine(`Status: ${scan.status}`);
  writeLine(`Created: ${scan.createdAt.toISOString()}`);
  if (scan.completedAt) writeLine(`Completed: ${scan.completedAt.toISOString()}`);

  cursorY -= 10;
  writeLine("Issues:", 14);
  if (scan.issues && Array.isArray(scan.issues)) {
    for (const issue of scan.issues.slice(0, 50)) {
      writeLine(`- ${issue.title} (${issue.severity})`, 11);
    }
  }

  const bytes = await pdf.save();
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="scan-${scan.id}.pdf"`);
  res.send(Buffer.from(bytes));
});

export default router;
