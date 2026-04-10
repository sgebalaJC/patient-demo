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

// Load on startup and watch for changes
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

/**
 * Build session ID and message prefix based on user context.
 *
 * Admin sessions → routed to the "main" agent (default)
 * Patient sessions → routed to the "patient-support" agent
 */
function buildSessionContext(user?: UserContext): {
  sessionId: string;
  messagePrefix: string;
} {
  if (!user) {
    return { sessionId: "admin-chat", messagePrefix: "" };
  }

  if (user.role === "patient") {
    return {
      sessionId: `patient:${user.uid}`,
      messagePrefix: `[Patient: ${user.name}]\n`,
    };
  }

  // Admin or assistant
  return {
    sessionId: `admin:${user.uid}`,
    messagePrefix: `[${user.role}: ${user.name}]\n`,
  };
}

/** POST /chat — forward message to OpenClaw via web-chat extension */
export async function handleChat(request: Request, user?: UserContext): Promise<Response> {
  if (!cachedToken) {
    return Response.json({ error: "Gateway token not configured" }, { status: 503 });
  }

  const body = (await request.json()) as {
    messages?: { role: string; content: string }[];
    message?: string;
    sessionId?: string;
    attachments?: { mimeType: string; content: string; name?: string }[];
  };

  // Accept either { messages: [...] } or { message: "..." }
  const messages = body.messages ?? (body.message
    ? [{ role: "user", content: body.message }]
    : null);

  if (!messages || messages.length === 0) {
    return Response.json({ error: "messages or message required" }, { status: 400 });
  }

  // Use the last user message as the chat body
  const lastUserMessage = [...messages].reverse().find(m => m.role === "user");
  if (!lastUserMessage) {
    return Response.json({ error: "No user message found" }, { status: 400 });
  }

  // Strip slash-command prefixes from patient messages so they can't trigger
  // OpenClaw native commands (/help, /status, /restart, etc.)
  let messageContent = lastUserMessage.content;
  if (user?.role === "patient" && messageContent.startsWith("/")) {
    messageContent = messageContent.replace(/^\/+/, "");
  }

  const { sessionId, messagePrefix } = buildSessionContext(user);

  try {
    const res = await fetch(`${GATEWAY_URL}/webhook/web-chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": cachedToken,
      },
      body: JSON.stringify({
        sessionId,
        body: messagePrefix + messageContent,
        timestamp: new Date().toISOString(),
        // Forward attachments (base64-encoded images/files)
        ...(body.attachments?.length ? { attachments: body.attachments } : {}),
        // Route to patient-support agent for patient sessions
        ...(user?.role === "patient" ? { accountId: "patient", agentId: "patient-support" } : {}),
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
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
