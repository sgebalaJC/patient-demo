import { readFileSync, watch } from "fs";
import { CONFIG_PATH, GATEWAY_URL } from "../lib/paths.js";
import type { UserContext } from "../lib/auth.js";
import {
  getBudgetState,
  recordUsage,
  estimateTokens,
  type GatewayUsage,
} from "../lib/platform-budget.js";

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
  // Budget check — if over allowance, request the economy model via header.
  // TODO(openclaw): honor `X-Model-Override` on the web-chat webhook. Until
  // then this header is a no-op — see docs/AI_AGENTS.md § Platform token
  // budget.
  const budget = await getBudgetState();
  const upstreamHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Webhook-Secret": cachedToken!,
    Accept: "text/event-stream",
  };
  if (budget.overBudget) {
    upstreamHeaders["X-Model-Override"] = budget.economyModel;
  }

  const res = await fetch(`${GATEWAY_URL}/webhook/web-chat`, {
    method: "POST",
    headers: upstreamHeaders,
    body: JSON.stringify({
      sessionId,
      body,
      timestamp: new Date().toISOString(),
      ...(attachments?.length ? { attachments } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    return Response.json(
      { error: `Gateway returned ${res.status}`, detail: text },
      { status: 502 },
    );
  }

  // SSE pass-through: forward upstream chunks to the client byte-for-byte,
  // while also intercepting the terminal `data: {"done":true,"usage":{...}}`
  // event so we can record token usage. Using a TransformStream keeps memory
  // bounded — we don't buffer the full reply.
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let lineBuf = "";
  let totalReplyLen = 0;
  let gatewayUsage: GatewayUsage | undefined;

  const pipe = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Sniff usage events without altering the bytes the client receives.
      lineBuf += decoder.decode(chunk, { stream: true });
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const evt = JSON.parse(payload) as {
            chunk?: string;
            done?: boolean;
            usage?: { inputTokens?: number; outputTokens?: number; model?: string };
          };
          if (typeof evt.chunk === "string") totalReplyLen += evt.chunk.length;
          if (evt.done && evt.usage) gatewayUsage = evt.usage;
        } catch { /* malformed event — let the client deal with it */ }
      }
      controller.enqueue(chunk);
    },
    flush() {
      // Fire-and-forget usage record. Prefer gateway's own numbers; fall
      // back to a char/4 estimate when missing (older OpenClaw builds).
      // TODO(openclaw): when usage is consistently surfaced, drop the
      // estimate fallback. See docs/AI_AGENTS.md § Platform token budget.
      if (gatewayUsage && (gatewayUsage.inputTokens || gatewayUsage.outputTokens)) {
        recordUsage(gatewayUsage);
      } else {
        recordUsage({
          inputTokens: estimateTokens(body),
          outputTokens: Math.ceil(totalReplyLen / 4),
        });
      }
    },
  });

  // Best-effort: hint encoder is unused if upstream is already utf-8 bytes.
  void encoder;

  return new Response(res.body.pipeThrough(pipe), {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
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

  // OpenClaw routes via `agent:<id>:...` session prefix. Names must match the
  // entries in openclaw.json on the host:
  //   - admin chat → `aurelia` agent (admin-style, full data access)
  //   - patient support → `sunny` agent (no PHI access)
  const sessionId = isPatientSupport
    ? `agent:sunny:patient:${user?.uid ?? "anonymous"}`
    : (user ? `agent:aurelia:admin:${user.uid}` : "agent:aurelia:admin-chat");

  // Enqueue — serializes per session so the gateway handles one message at a time
  return enqueue(sessionId, () =>
    sendToGateway(sessionId, prefix + messageContent, body.attachments)
  );
}
