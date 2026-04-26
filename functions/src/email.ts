/**
 * Transactional email system using Nodemailer.
 *
 * Requires two secrets:
 *   SMTP_USER — sending Gmail address (e.g. noreply@practice.com)
 *   SMTP_PASS — Gmail app password (requires 2FA on the account)
 *
 * If secrets are not set, all sends silently no-op so other flows are not affected.
 */

import * as nodemailer from "nodemailer";
import {logger} from "firebase-functions";
import {FUNCTIONS_BRANDING} from "./branding.js";
import {INCLUDE_SIM_MODE} from "./lib/sim-flag.js";

const B = FUNCTIONS_BRANDING;

function createTransport() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// ── Core send ────────────────────────────────────────────────────────

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<boolean> {
  // Sim short-circuit: the global simulation flag routes transactional
  // email to simulation/workspace/emails instead of SMTP. Admins see it
  // in the sandbox; nothing leaves the tenant. Build-time flag gates
  // the lookup entirely so installer-emitted forks ship zero sim code.
  if (INCLUDE_SIM_MODE) {
    try {
      const admin = await import("firebase-admin");
      const snap = await admin.firestore().doc("system/settings").get();
      if (snap.exists && snap.data()?.simulationMode === true) {
        const {recordSimEmail} = await import("./simulation/simulators/workspace.js");
        await recordSimEmail({to: opts.to, subject: opts.subject, body: opts.text || opts.html, kind: "transactional"});
        return true;
      }
    } catch {
      /* tolerate — fall through to real send */
    }
  }

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    logger.info("Email skipped — SMTP_USER/SMTP_PASS not configured");
    return false;
  }

  try {
    const transporter = createTransport();
    await transporter.sendMail({
      from: `"${B.shortName}" <${process.env.SMTP_USER}>`,
      ...opts,
    });
    logger.info("Email sent", { subject: opts.subject });
    return true;
  } catch (err) {
    logger.error("Email send failed:", err);
    return false;
  }
}

// ── Shared layout ────────────────────────────────────────────────────

function wrap(body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; max-width: 560px; margin: 0 auto; padding: 24px;">
  <div style="border-bottom: 2px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 24px;">
    <strong style="font-size: 18px;">${B.practiceName}</strong>
  </div>
  ${body}
  <div style="border-top: 1px solid #e5e7eb; margin-top: 32px; padding-top: 16px; font-size: 12px; color: #6b7280;">
    This is an automated message from ${B.practiceName}. Please do not reply to this email.
  </div>
</body>
</html>`;
}

// ── Templates ────────────────────────────────────────────────────────

export function appointmentConfirmedEmail(
  patientName: string,
  date: string,
  time: string,
) {
  return {
    subject: `Appointment Confirmed — ${date}`,
    html: wrap(`
      <p>Hi ${patientName},</p>
      <p>Your appointment has been <strong>confirmed</strong>.</p>
      <table style="margin: 16px 0; border-collapse: collapse;">
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Date</td><td>${date}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Time</td><td>${time}</td></tr>
      </table>
      <p>If you need to reschedule, please contact us.</p>
    `),
    text: `Hi ${patientName}, your appointment on ${date} at ${time} has been confirmed. If you need to reschedule, please contact us. — ${B.shortName}`,
  };
}

export function appointmentCancelledEmail(
  patientName: string,
  date: string,
  time: string,
) {
  return {
    subject: `Appointment Cancelled — ${date}`,
    html: wrap(`
      <p>Hi ${patientName},</p>
      <p>Your appointment on <strong>${date}</strong> at <strong>${time}</strong> has been <strong>cancelled</strong>.</p>
      <p>Please contact us if you would like to reschedule.</p>
    `),
    text: `Hi ${patientName}, your appointment on ${date} at ${time} has been cancelled. Please contact us to reschedule. — ${B.shortName}`,
  };
}

export function welcomeEmail(patientName: string, portalUrl: string) {
  return {
    subject: `Welcome to ${B.practiceName}`,
    html: wrap(`
      <p>Hi ${patientName},</p>
      <p>Welcome to ${B.practiceName}! Your patient account has been created.</p>
      <p>You can access your patient portal to manage appointments, messages, prescriptions, and more:</p>
      <p style="margin: 20px 0;">
        <a href="${portalUrl}" style="background-color: #2563eb; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; display: inline-block;">Open Patient Portal</a>
      </p>
      <p>If you have any questions, don't hesitate to reach out.</p>
    `),
    text: `Hi ${patientName}, welcome to ${B.practiceName}! Access your patient portal at ${portalUrl}. — ${B.shortName}`,
  };
}

export function refillStatusEmail(
  patientName: string,
  medicationName: string,
  status: "approved" | "denied",
  notes?: string,
) {
  const statusLabel = status === "approved" ? "Approved" : "Denied";
  const statusColor = status === "approved" ? "#059669" : "#dc2626";

  return {
    subject: `Prescription Refill ${statusLabel} — ${medicationName}`,
    html: wrap(`
      <p>Hi ${patientName},</p>
      <p>Your refill request for <strong>${medicationName}</strong> has been
        <strong style="color: ${statusColor};">${statusLabel.toLowerCase()}</strong>.</p>
      ${notes ? `<p style="background: #f9fafb; padding: 12px; border-radius: 6px; margin: 16px 0;"><em>${notes}</em></p>` : ""}
      <p>Please contact us if you have any questions.</p>
    `),
    text: `Hi ${patientName}, your refill request for ${medicationName} has been ${statusLabel.toLowerCase()}.${notes ? " Note: " + notes : ""} — ${B.shortName}`,
  };
}
