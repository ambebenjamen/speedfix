import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth";
import scanRoutes from "./routes/scans";
import adminRoutes from "./routes/admin";

const app = express();
const port = Number(process.env.PORT ?? 4000);

const normalizeOrigin = (value: string) => value.trim().replace(/\/+$/, "");
const allowedOrigins = [
  process.env.FRONTEND_URL,
  ...(process.env.CORS_ORIGINS ?? "").split(","),
]
  .filter((v): v is string => Boolean(v && v.trim()))
  .map(normalizeOrigin);

app.use(
  cors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void
    ) => {
      // Allow non-browser clients and same-origin server calls.
      if (!origin) return callback(null, true);
      const normalized = normalizeOrigin(origin);
      if (allowedOrigins.includes(normalized)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/auth", authRoutes);
app.use("/scans", scanRoutes);
app.use("/admin", adminRoutes);

app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
