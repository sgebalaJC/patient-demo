/**
 * Real Twilio SMS — outbound send + inbound webhook.
 *
 * Sim counterpart: `../sim/messaging.ts`. The admin-api messaging case
 * picks between these two based on `system/settings.simulationMode`.
 *
 * Inbound webhook is mounted BEFORE the auth gate in index.ts and is
 * HMAC-SHA1-verified against Twilio's X-Twilio-Signature header.
 *
 * PII logging policy: only SIDs and phone last-4 appear in logs.
 */

import { getDb } from "../lib/firebase.js";
import { toE164Lenient } from "../lib/phone.js";
import { FieldValue } from "firebase-admin/firestore";
import { createHmac, timingSafeEqual } from "node:crypto";

// Cached once on first call — env doesn't change under us, so we don't
// need to re-read process.env per-request. Stays lazy so a sim-only
// deployment without Twilio creds doesn't fail at import time.
let _twilioAuth: { sid: string; token: string; from: string } | null = null;
function twilioAuth(): { sid: string; token: string; from: string } {
  if (_twilioAuth) return _twilioAuth;
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const token = process.env.TWILIO_AUTH_TOKEN || "";
  const from = process.env.TWILIO_PHONE_NUMBER || "";
  if (!sid || !token || !from) {
    throw new Error("Twilio credentials missing (TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER)");
  }
  _twilioAuth = { sid, token, from };
  return _twilioAuth;
}

// ---------------------------------------------------------------------------
// Outbound — real Twilio send
// ---------------------------------------------------------------------------

export async function realSmsSend(request: Request): Promise<Response> {
  let body: { to?: string; body?: string; kind?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const toNormalized = toE164Lenient(body.to || "");
  if (!toNormalized) return Response.json({ error: "Valid recipient phone required" }, { status: 400 });
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) return Response.json({ error: "Message body required" }, { status: 400 });
  if (text.length > 1600) return Response.json({ error: "Message exceeds 1600 characters" }, { status: 400 });

  const { sid: accountSid, token, from } = twilioAuth();
  const form = new URLSearchParams({ From: from, To: toNormalized, Body: text });
  const basic = Buffer.from(`${accountSid}:${token}`).toString("base64");

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(`[sms] Twilio send failed ${res.status}`, errText.slice(0, 200));
    return Response.json(
      { error: `Twilio error ${res.status}: ${errText.slice(0, 200)}` },
      { status: 502 },
    );
  }

  const twilioBody = (await res.json()) as { sid: string; status: string };
  const msgSid = twilioBody.sid;
  const status = twilioBody.status || "queued";

  await getDb().collection("sms-outbound").doc(msgSid).set({
    sid: msgSid,
    from,
    to: toNormalized,
    body: text,
    kind: body.kind || "manual",
    status,
    sentAt: FieldValue.serverTimestamp(),
  });

  console.log(`[sms] sent sid=${msgSid} toLast4=${toNormalized.slice(-4)}`);
  return Response.json({ ok: true, sid: msgSid, status });
}

// ---------------------------------------------------------------------------
// Inbound webhook — public, signature-verified
// ---------------------------------------------------------------------------

function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string,
  authToken: string,
): boolean {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const k of sortedKeys) data += k + params[k];
  const expected = createHmac("sha1", authToken).update(data).digest("base64");
  // Constant-time compare to prevent timing attacks on webhook forgery.
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function inboundSmsWebhook(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const raw = await request.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;

  let token: string;
  try {
    token = twilioAuth().token;
  } catch {
    console.error("[sms-inbound] TWILIO_AUTH_TOKEN missing — cannot verify");
    return new Response("Server misconfigured", { status: 500 });
  }

  const fwdProto = request.headers.get("x-forwarded-proto") || "http";
  const fwdHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const reqUrl = new URL(request.url);
  const effectiveUrl = fwdHost ? `${fwdProto}://${fwdHost}${reqUrl.pathname}${reqUrl.search}` : request.url;

  const signature = request.headers.get("x-twilio-signature") || "";
  if (!signature || !verifyTwilioSignature(effectiveUrl, params, signature, token)) {
    console.warn("[sms-inbound] signature check failed", {
      url: effectiveUrl,
      sigPresent: !!signature,
    });
    return new Response("Forbidden", { status: 403 });
  }

  const sid = params.MessageSid || params.SmsMessageSid;
  if (!sid) return new Response("Missing MessageSid", { status: 400 });

  await getDb().collection("sms-inbound").doc(sid).set({
    sid,
    from: params.From || "",
    to: params.To || "",
    body: params.Body || "",
    status: "received",
    receivedAt: FieldValue.serverTimestamp(),
  });

  console.log(`[sms-inbound] captured sid=${sid} fromLast4=${(params.From || "").slice(-4)}`);
  return new Response("<Response></Response>", {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
