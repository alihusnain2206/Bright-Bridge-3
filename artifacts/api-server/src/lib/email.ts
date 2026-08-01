/**
 * email.ts — thin nodemailer wrapper for transactional email.
 *
 * Configure via environment variables:
 *   SMTP_HOST   — SMTP server hostname (e.g. smtp.gmail.com)
 *   SMTP_PORT   — port, default 587
 *   SMTP_USER   — SMTP username / email address
 *   SMTP_PASS   — SMTP password or app password
 *   SMTP_FROM   — "From" address (defaults to SMTP_USER)
 *   APP_URL     — base URL of the app (e.g. https://yourapp.replit.app)
 *
 * If SMTP_HOST / SMTP_USER / SMTP_PASS are not set the email is only
 * logged to the console so the reset flow still works in development.
 */

import nodemailer from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT ?? "587", 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM ?? SMTP_USER ?? "noreply@brightbridge.app";
export const APP_URL  = (process.env.APP_URL ?? "").replace(/\/$/, "");

function isConfigured(): boolean {
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function createTransport() {
  return nodemailer.createTransport({
    host:   SMTP_HOST,
    port:   SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth:   { user: SMTP_USER, pass: SMTP_PASS },
  });
}

export async function sendPasswordResetEmail(opts: {
  to:        string;
  name:      string;
  resetLink: string;
}): Promise<void> {
  const { to, name, resetLink } = opts;

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#111">
      <h2 style="margin:0 0 8px;font-size:20px">Reset your BrightBridge password</h2>
      <p style="color:#555;margin:0 0 24px">Hi ${name}, we received a request to reset the password for your account.</p>
      <a href="${resetLink}"
         style="display:inline-block;background:#E8622A;color:#fff;text-decoration:none;
                padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px">
        Reset password
      </a>
      <p style="color:#888;font-size:13px;margin:24px 0 0">
        This link expires in <strong>1 hour</strong>. If you didn't request a reset, you can ignore this email.
      </p>
      <hr style="border:none;border-top:1px solid #eee;margin:28px 0" />
      <p style="color:#aaa;font-size:12px;margin:0">
        Or copy this URL into your browser:<br/>
        <span style="color:#555">${resetLink}</span>
      </p>
    </div>
  `;

  const text = `Reset your BrightBridge password\n\nHi ${name},\n\nClick the link below to reset your password (expires in 1 hour):\n${resetLink}\n\nIf you didn't request a reset, ignore this email.`;

  if (!isConfigured()) {
    // Dev fallback — print link to console so the feature works without SMTP
    console.warn("[email] SMTP not configured — password reset link (dev only):");
    console.warn(`[email] ${resetLink}`);
    return;
  }

  const transporter = createTransport();
  await transporter.sendMail({
    from:    `BrightBridge <${SMTP_FROM}>`,
    to,
    subject: "Reset your BrightBridge password",
    text,
    html,
  });
}
