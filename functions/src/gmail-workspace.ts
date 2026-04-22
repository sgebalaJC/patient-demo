/**
 * Gmail API helpers for the Google Workspace OAuth integration.
 * Used by the googleWorkspaceProxy Cloud Function.
 */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

export interface GmailMessage {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  body: string;
  date: string;
}

export async function listInboxMessages(
  accessToken: string,
  maxResults = 10,
): Promise<GmailMessage[]> {
  const res = await fetch(
    `${GMAIL_API}/users/me/messages?labelIds=INBOX&maxResults=${maxResults}`,
    {headers: {Authorization: `Bearer ${accessToken}`}},
  );
  if (!res.ok) throw new Error(`Gmail list failed: ${res.status}`);
  const data = await res.json();

  const messages: GmailMessage[] = [];
  for (const item of data.messages ?? []) {
    const msg = await getFullMessage(accessToken, item.id as string);
    if (msg) messages.push(msg);
  }
  return messages;
}

export async function getFullMessage(
  accessToken: string,
  messageId: string,
): Promise<GmailMessage | null> {
  const res = await fetch(
    `${GMAIL_API}/users/me/messages/${messageId}?format=full`,
    {headers: {Authorization: `Bearer ${accessToken}`}},
  );
  if (!res.ok) return null;
  const msg = await res.json();

  const headers = msg.payload?.headers ?? [];
  const getHeader = (name: string) =>
    headers.find(
      (h: {name: string}) => h.name.toLowerCase() === name.toLowerCase()
    )?.value ?? "";

  let body = "";
  if (msg.payload?.body?.data) {
    body = Buffer.from(msg.payload.body.data, "base64url").toString("utf8");
  } else if (msg.payload?.parts) {
    const textPart = msg.payload.parts.find(
      (p: {mimeType: string}) => p.mimeType === "text/plain"
    );
    if (textPart?.body?.data) {
      body = Buffer.from(textPart.body.data, "base64url").toString("utf8");
    }
  }
  if (body.length > 5000) body = body.slice(0, 5000) + "\n...[truncated]";

  return {
    id: messageId,
    from: getHeader("From"),
    subject: getHeader("Subject"),
    snippet: msg.snippet ?? "",
    body,
    date: getHeader("Date"),
  };
}

export async function sendEmail(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
  from?: string,
): Promise<{messageId: string; threadId: string}> {
  // Sim short-circuit: the global simulation flag routes outbound email to
  // simulation/workspace/emails instead of Gmail. Admins see it in the
  // sandbox view; nothing leaves the tenant.
  try {
    const admin = await import("firebase-admin");
    const snap = await admin.firestore().doc("system/settings").get();
    if (snap.exists && snap.data()?.simulationMode === true) {
      const {recordSimEmail} = await import("./simulation/simulators/workspace.js");
      return await recordSimEmail({to, from, subject, body, kind: "gmail-send"});
    }
  } catch {
    /* tolerate — fall through to real send */
  }

  const raw = [
    ...(from ? [`From: ${from}`] : []),
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].join("\r\n");

  const encoded = Buffer.from(raw).toString("base64url");

  const res = await fetch(`${GMAIL_API}/users/me/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({raw: encoded}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail send failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {messageId: data.id as string, threadId: data.threadId as string};
}

export async function replyToEmail(
  accessToken: string,
  messageId: string,
  body: string,
  from?: string,
): Promise<{messageId: string; threadId: string}> {
  const origRes = await fetch(
    `${GMAIL_API}/users/me/messages/${messageId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject&metadataHeaders=From`,
    {headers: {Authorization: `Bearer ${accessToken}`}},
  );
  if (!origRes.ok) throw new Error(`Failed to fetch original: ${origRes.status}`);
  const origData = await origRes.json();

  const origHeaders = origData.payload?.headers ?? [];
  const getOrigHeader = (name: string) =>
    origHeaders.find(
      (h: {name: string}) => h.name.toLowerCase() === name.toLowerCase()
    )?.value ?? "";

  const origMessageId = getOrigHeader("Message-ID");
  const origSubject = getOrigHeader("Subject");
  const replyTo = getOrigHeader("From");

  const subject = origSubject.startsWith("Re:") ? origSubject : `Re: ${origSubject}`;

  const raw = [
    ...(from ? [`From: ${from}`] : []),
    `To: ${replyTo}`,
    `Subject: ${subject}`,
    `In-Reply-To: ${origMessageId}`,
    `References: ${origMessageId}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].join("\r\n");

  const encoded = Buffer.from(raw).toString("base64url");

  const res = await fetch(`${GMAIL_API}/users/me/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({raw: encoded, threadId: origData.threadId}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail reply failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {messageId: data.id as string, threadId: data.threadId as string};
}
