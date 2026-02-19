import jwt from "jsonwebtoken";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { prisma } from "./prisma";

const jwtSecret = process.env.JWT_SECRET ?? "dev-secret";

export const signToken = (userId: string) => {
  return jwt.sign({ sub: userId }, jwtSecret, { expiresIn: "30d" });
};

export const verifyToken = (token: string) => {
  return jwt.verify(token, jwtSecret) as { sub: string };
};

export const createVerificationToken = async (email: string) => {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 15 * 60 * 1000);

  await prisma.verificationToken.create({
    data: {
      identifier: email,
      token,
      expires,
    },
  });

  return { token, expires };
};

export const useVerificationToken = async (email: string, token: string) => {
  const record = await prisma.verificationToken.findUnique({
    where: { identifier_token: { identifier: email, token } },
  });

  if (!record || record.expires < new Date()) {
    return null;
  }

  await prisma.verificationToken.delete({
    where: { identifier_token: { identifier: email, token } },
  });

  return record;
};

export const sendMagicLink = async (email: string, link: string) => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.EMAIL_FROM ?? "noreply@example.com",
    to: email,
    subject: "Your FixSpeed sign-in link",
    text: `Click to sign in: ${link}`,
    html: `<p>Click to sign in:</p><p><a href="${link}">${link}</a></p>`,
  });
};
