/**
 * Real SignalWire SMS — outbound send + inbound webhook.
 *
 * Sim counterpart: `../sim/messaging.ts`. The admin-api messaging case
 * picks between these two based on `system/settings.simulationMode`.
 *
 * SignalWire's LaML subsystem is Twilio-API-compatible: same form shape
 * for Messages.json, same HMAC-SHA1-over-sorted-params webhook signature
 * algorithm. Only the host, auth identity (projectId vs accountSid), and
 * signature header name differ.
 *
 * Inbound webhook is mounted BEFORE the auth gate in index.ts and is
 * HMAC-SHA1-verified against SignalWire's X-SignalWire-Signature header
 * (with fallback to X-Twilio-Signature for tenants that kept the legacy
 * header when porting from Twilio).
 *
 * PII logging policy: only SIDs and phone last-4 appear in logs.
 */

import { getDb } from "../lib/firebase.js";
import { toE164Lenient } from "../lib/phone.js";
import { FieldValue } from "firebase-admin/firestore";
import { createHmac, timingSafeEqual } from "node:crypto";

// Cached once on first call — env doesn't change under us. Stays lazy so
// a sim-only deployment without SignalWire creds doesn't fail at import
// time.
let _swAuth: {
  projectId: string;
  authToken: string;
  spaceUrl: string;
  from: string;
} | null = null;
function swAuth(): {
  projectId: string;
  authToken: string;
  spaceUrl: string;
  from: string;
} {
  if (_swAuth) return _swAuth;
  const projectId = process.env.SIGNALWIRE_PROJECT_ID || "";
  const authToken = process.env.SIGNALWIRE_AUTH_TOKEN || "";
  const spaceUrl = (process.env.SIGNALWIRE_SPACE_URL || "").replace(/\/+$/, "");
  const from = process.env.SIGNALWIRE_SMS_FROM || "";
  if (!projectId || !authToken || !spaceUrl || !from) {
    throw new Error(
      "SignalWire SMS credentials missing (SIGNALWIRE_PROJECT_ID/AUTH_TOKEN/SPACE_URL/SMS_FROM)",
    );
  }
  _swAuth = { projectId, authToken, spaceUrl, from };
  return _swAuth;
}

// ---------------------------------------------------------------------------
// Outbound — real SignalWire LaML send
// ---------------------------------------------------------------------------

// SignalWire (and Twilio LaML) enforce a 1600-char cap per outbound SMS
// (concatenated long message). Reject anything longer at the boundary so
// callers get a clear 400 instead of an opaque provider error.
const MAX_SMS_BODY_CHARS = 1600;

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
  if (text.length > MAX_SMS_BODY_CHARS) {
    return Response.json(
      { error: `Message exceeds ${MAX_SMS_BODY_CHARS} characters` },
      { status: 400 },
    );
  }

  const { projectId, authToken, spaceUrl, from } = swAuth();
  const form = new URLSearchParams({ From: from, To: toNormalized, Body: text });
  const basic = Buffer.from(`${projectId}:${authToken}`).toString("base64");

  const res = await fetch(
    `https://${spaceUrl}/api/laml/2010-04-01/Accounts/${projectId}/Messages.json`,
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
    console.error(`[sms] SignalWire send failed ${res.status}`, errText.slice(0, 200));
    return Response.json(
      { error: `SignalWire error ${res.status}: ${errText.slice(0, 200)}` },
      { status: 502 },
    );
  }

  const swBody = (await res.json()) as { sid: string; status: string };
  const msgSid = swBody.sid;
  const status = swBody.status || "queued";

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

function verifySignature(
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

  // Prefer the signing-key-scoped secret if present, else fall back to the
  // API auth token. SignalWire signs webhooks with whichever the tenant
  // configured; legacy Twilio-ported accounts typically use the auth token.
  let token: string;
  try {
    token = process.env.SIGNALWIRE_SIGNING_KEY || swAuth().authToken;
  } catch {
    console.error("[sms-inbound] SIGNALWIRE_AUTH_TOKEN missing — cannot verify");
    return new Response("Server misconfigured", { status: 500 });
  }

  const fwdProto = request.headers.get("x-forwarded-proto") || "http";
  const fwdHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const reqUrl = new URL(request.url);
  const effectiveUrl = fwdHost ? `${fwdProto}://${fwdHost}${reqUrl.pathname}${reqUrl.search}` : request.url;

  // SignalWire sets X-SignalWire-Signature. Accept X-Twilio-Signature too
  // so the webhook keeps working if the tenant ports over from Twilio and
  // points the existing webhook URL at SignalWire mid-migration.
  const signature =
    request.headers.get("x-signalwire-signature") ||
    request.headers.get("x-twilio-signature") ||
    "";
  if (!signature || !verifySignature(effectiveUrl, params, signature, token)) {
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
