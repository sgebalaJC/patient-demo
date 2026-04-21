// Tiny Slack alert helper for the prior-auth subsystem. Posts to the
// incoming webhook configured at SLACK_ALERTS_WEBHOOK_URL. No-op when unset.
//
// Per-fork setup: create an incoming webhook in the practice's Slack, then:
//   firebase functions:secrets:set SLACK_ALERTS_WEBHOOK_URL
// Bind it on `policyFetcherCron` (and any other function that uses
// alertSlack). This is separate from the OpenClaw Slack token — that one is
// gateway-bound to the admin agent and shouldn't receive ops alerts.

import {logger} from "firebase-functions";
import {FUNCTIONS_BRANDING} from "./../branding.js";

const WEBHOOK = process.env.SLACK_ALERTS_WEBHOOK_URL || "";

export async function alertSlack(text: string): Promise<void> {
  if (!WEBHOOK) {
    logger.info("pa.slack-alerts:skipped (no webhook configured)", {textPreview: text.slice(0, 80)});
    return;
  }
  try {
    const res = await fetch(WEBHOOK, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({text, mrkdwn: true}),
    });
    if (!res.ok) {
      logger.warn("pa.slack-alerts:non200", {status: res.status});
    }
  } catch (err) {
    logger.warn("pa.slack-alerts:error", {err: String(err)});
  }
}

export function formatBrokenAlert(
  payerId: string,
  cptCode: string,
  reason: string,
): string {
  const base = FUNCTIONS_BRANDING.portalUrl || "";
  const link = base
    ? `<${base}/admin/prior-auth/policies/${payerId}_${cptCode}|Open in admin>`
    : "";
  return [
    ":rotating_light: *Prior-auth fetcher: broken policy*",
    `• Payer: \`${payerId}\``,
    `• CPT: \`${cptCode}\``,
    `• Reason: ${reason.slice(0, 400)}`,
    link,
  ].filter(Boolean).join("\n");
}
