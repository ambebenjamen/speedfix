import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import authRoutes from "./routes/auth";
import scanRoutes from "./routes/scans";
import adminRoutes from "./routes/admin";
import { prisma } from "./prisma";

const app = express();
const port = Number(process.env.PORT ?? 4000);
let dbReady = false;

/**
 * Normalize origin (remove trailing slash)
 */
const normalizeOrigin = (value: string) =>
  value.trim().replace(/\/+$/, "");

/**
 * Allowed origins from ENV
 */
const allowedOrigins = [
  process.env.FRONTEND_URL,
  ...(process.env.CORS_ORIGINS ?? "").split(","),
]
  .filter((v): v is string => Boolean(v && v.trim()))
  .map(normalizeOrigin);

// DEBUG LOG
console.log("Allowed Origins:", allowedOrigins);

/**
 * CORS CONFIG (TYPE-SAFE + CREDENTIALS)
 */
const corsOptions = {
  origin: (
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void
  ) => {
    // allow non-browser tools (Postman, curl, server-to-server)
    if (!origin) return callback(null, true);

    const normalized = normalizeOrigin(origin);

    if (allowedOrigins.includes(normalized)) {
      return callback(null, true);
    }

    console.error("Blocked by CORS:", origin);
    return callback(new Error(`CORS not allowed: ${origin}`));
  },
  credentials: true,
};

/**
 * Apply CORS FIRST
 */
app.use(cors(corsOptions));

/**
 * Handle preflight requests (OPTIONS)
 */
app.options(/.*/, cors(corsOptions));

/**
 * Middlewares
 */
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

/**
 * Health check (frontend wake-up)
 */
app.get("/health", (_req, res) => {
  res.json({ ok: true, dbReady });
});

/**
 * While database is waking up, return a proper HTTP response instead of a
 * network-level failure that browsers surface as a CORS error.
 */
app.use((req, res, next) => {
  if (dbReady || req.path === "/health") {
    return next();
  }

  return res
    .status(503)
    .json({ error: "Backend is waking up. Please retry shortly." });
});

/**
 * Routes
 */
app.use("/auth", authRoutes);
app.use("/scans", scanRoutes);
app.use("/admin", adminRoutes);

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const waitForDatabase = async () => {
  const maxAttempts = Number(process.env.DB_CONNECT_MAX_ATTEMPTS ?? 12);
  const baseDelayMs = Number(process.env.DB_CONNECT_RETRY_DELAY_MS ?? 2500);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await prisma.$connect();
      console.log("Database connected");
      dbReady = true;
      return;
    } catch (error) {
      const isLastAttempt = attempt === maxAttempts;
      console.error(
        `DB connection attempt ${attempt}/${maxAttempts} failed`,
        error
      );

      if (isLastAttempt) {
        throw error;
      }

      await sleep(baseDelayMs * attempt);
    }
  }
};

/**
 * Start server
 */
const startServer = async () => {
  app.listen(port, () => {
    console.log(`Backend running on port ${port}`);
  });

  try {
    await waitForDatabase();
  } catch (error) {
    console.error("Failed to connect DB after retries", error);
  }
};

void startServer();
