import { readFileSync, watch } from "fs";
import { CONFIG_PATH, GATEWAY_URL } from "../lib/paths.js";
import type { UserContext } from "../lib/auth.js";

let cachedToken: string | null = null;

function loadToken(): string | null {
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    return config?.gateway?.auth?.token ?? null;
  } catch {
    return null;
  }
}

cachedToken = loadToken();
try {
  watch(CONFIG_PATH, () => {
    const newToken = loadToken();
    if (newToken && newToken !== cachedToken) {
      cachedToken = newToken;
      console.log("[chat] gateway token reloaded from config");
    }
  });
} catch { /* config may not exist yet */ }

// ---------------------------------------------------------------------------
// Per-patient rate limiter — admins are unlimited
// ---------------------------------------------------------------------------

const RATE_LIMIT_PER_MINUTE = 10;
const RATE_LIMIT_PER_HOUR = 60;

interface RateBucket {
  minuteCount: number;
  minuteReset: number;
  hourCount: number;
  hourReset: number;
}

const rateBuckets = new Map<string, RateBucket>();

function checkChatRateLimit(uid: string): string | null {
  const now = Date.now();
  let bucket = rateBuckets.get(uid);

  if (!bucket) {
    bucket = { minuteCount: 0, minuteReset: now + 60_000, hourCount: 0, hourReset: now + 3_600_000 };
    rateBuckets.set(uid, bucket);
  }

  if (now > bucket.minuteReset) { bucket.minuteCount = 0; bucket.minuteReset = now + 60_000; }
  if (now > bucket.hourReset) { bucket.hourCount = 0; bucket.hourReset = now + 3_600_000; }

  bucket.minuteCount++;
  bucket.hourCount++;

  if (bucket.minuteCount > RATE_LIMIT_PER_MINUTE) {
    return "You're sending messages too quickly. Please wait a moment.";
  }
  if (bucket.hourCount > RATE_LIMIT_PER_HOUR) {
    return "You've reached the message limit. Please try again later or contact us at support@showmd.org.";
  }
  return null;
}

// Clean up stale rate buckets every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [uid, bucket] of rateBuckets) {
    if (now > bucket.hourReset) rateBuckets.delete(uid);
  }
}, 600_000);

// ---------------------------------------------------------------------------
// Per-session message queue — serializes messages so the gateway processes
// one at a time per session. Prevents race conditions and dropped messages.
// ---------------------------------------------------------------------------

type QueuedRequest = {
  resolve: (res: Response) => void;
  run: () => Promise<Response>;
};

const sessionQueues = new Map<string, QueuedRequest[]>();
const sessionBusy = new Set<string>();

async function enqueue(sessionId: string, run: () => Promise<Response>): Promise<Response> {
  return new Promise<Response>((resolve) => {
    const queue = sessionQueues.get(sessionId) ?? [];
    queue.push({ resolve, run });
    sessionQueues.set(sessionId, queue);

    if (!sessionBusy.has(sessionId)) {
      flush(sessionId);
    }
  });
}

async function flush(sessionId: string): Promise<void> {
  const queue = sessionQueues.get(sessionId);
  if (!queue || queue.length === 0) {
    sessionBusy.delete(sessionId);
    sessionQueues.delete(sessionId);
    return;
  }

  sessionBusy.add(sessionId);
  const item = queue.shift()!;

  try {
    const res = await item.run();
    item.resolve(res);
  } catch (err) {
    item.resolve(Response.json({ error: String(err) }, { status: 502 }));
  }

  // Process next in queue
  flush(sessionId);
}

// Clean up stale queue entries every 5 minutes
setInterval(() => {
  for (const [id] of sessionQueues) {
    if (!sessionBusy.has(id)) sessionQueues.delete(id);
  }
}, 300_000);

// ---------------------------------------------------------------------------
// Chat handler
// ---------------------------------------------------------------------------

async function sendToGateway(
  sessionId: string,
  body: string,
  attachments?: { mimeType: string; content: string; name?: string }[],
): Promise<Response> {
  const res = await fetch(`${GATEWAY_URL}/webhook/web-chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Secret": cachedToken!,
    },
    body: JSON.stringify({
      sessionId,
      body,
      timestamp: new Date().toISOString(),
      ...(attachments?.length ? { attachments } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const text = await res.text();
    return Response.json(
      { error: `Gateway returned ${res.status}`, detail: text },
      { status: 502 },
    );
  }

  const data = await res.json() as { reply?: string };
  return Response.json({ role: "assistant", content: data.reply || "" });
}

/** POST /chat — route to the appropriate agent via web-chat webhook */
export async function handleChat(request: Request, user?: UserContext): Promise<Response> {
  if (!cachedToken) {
    return Response.json({ error: "Gateway token not configured" }, { status: 503 });
  }

  const body = (await request.json()) as {
    messages?: { role: string; content: string }[];
    message?: string;
    attachments?: { mimeType: string; content: string; name?: string }[];
    support?: boolean;
  };

  const messages = body.messages ?? (body.message
    ? [{ role: "user", content: body.message }]
    : null);

  if (!messages || messages.length === 0) {
    return Response.json({ error: "messages or message required" }, { status: 400 });
  }

  const lastUserMessage = [...messages].reverse().find(m => m.role === "user");
  if (!lastUserMessage) {
    return Response.json({ error: "No user message found" }, { status: 400 });
  }

  let messageContent = lastUserMessage.content;

  const isPatientSupport = user?.role !== "admin" || body.support === true;

  // Rate limit non-admin users
  if (user && user.role !== "admin") {
    const limited = checkChatRateLimit(user.uid);
    if (limited) {
      return Response.json({ role: "assistant", content: limited });
    }
  }

  if (user?.role !== "admin" && messageContent.startsWith("/")) {
    messageContent = messageContent.replace(/^\/+/, "");
  }

  const prefix = user
    ? (isPatientSupport ? `[Patient: ${user.name}]\n` : `[${user.role}: ${user.name}]\n`)
    : "";

  const sessionId = isPatientSupport
    ? `agent:patient-support:patient:${user?.uid ?? "anonymous"}`
    : (user ? `admin:${user.uid}` : "admin-chat");

  // Enqueue — serializes per session so the gateway handles one message at a time
  return enqueue(sessionId, () =>
    sendToGateway(sessionId, prefix + messageContent, body.attachments)
  );
}
