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

  // Non-admins always go to patient-support (Sunny). Admins go to Sunny
  // only when support flag is set (from the support chat page).
  const isPatientSupport = user?.role !== "admin" || body.support === true;

  // Strip slash commands for non-admin users
  if (user?.role !== "admin" && messageContent.startsWith("/")) {
    messageContent = messageContent.replace(/^\/+/, "");
  }

  // Build message with user context prefix
  const prefix = user
    ? (isPatientSupport ? `[Patient: ${user.name}]\n` : `[${user.role}: ${user.name}]\n`)
    : "";

  // Session ID with agent prefix for routing:
  // "agent:patient-support:patient:UID" → web-chat plugin routes to patient-support
  // "admin:UID" → routes to main agent (default)
  const sessionId = isPatientSupport
    ? `agent:patient-support:patient:${user?.uid ?? "anonymous"}`
    : (user ? `admin:${user.uid}` : "admin-chat");

  try {
    const res = await fetch(`${GATEWAY_URL}/webhook/web-chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": cachedToken,
      },
      body: JSON.stringify({
        sessionId,
        body: prefix + messageContent,
        timestamp: new Date().toISOString(),
        ...(body.attachments?.length ? { attachments: body.attachments } : {}),
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
