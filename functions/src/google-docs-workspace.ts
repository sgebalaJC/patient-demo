/**
 * Google Docs API helpers for the Google Workspace integration.
 * Used by the googleWorkspaceProxy Cloud Function.
 *
 * Scope: https://www.googleapis.com/auth/documents (read + write).
 * Exposed through the agent's google-workspace skill under {service:
 * "docs", action: "..."}. `drive.read` (text export) stays the cheap
 * path for "just give me the body"; these helpers are for structural
 * inserts and raw batchUpdate.
 */

const DOCS_API = "https://docs.googleapis.com/v1/documents";

export interface DocSummary {
  documentId: string;
  title: string;
  revisionId: string;
  bodyContent: Record<string, unknown>;
}

export async function readDoc(
  accessToken: string,
  documentId: string,
): Promise<DocSummary> {
  const res = await fetch(
    `${DOCS_API}/${encodeURIComponent(documentId)}`,
    {headers: {Authorization: `Bearer ${accessToken}`}},
  );
  if (!res.ok) throw new Error(`Docs read failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as {
    documentId: string;
    title: string;
    revisionId: string;
    body?: Record<string, unknown>;
  };
  return {
    documentId: data.documentId,
    title: data.title ?? "",
    revisionId: data.revisionId,
    bodyContent: data.body ?? {},
  };
}

export async function insertText(
  accessToken: string,
  documentId: string,
  text: string,
  index = 1,
): Promise<void> {
  await batchUpdate(accessToken, documentId, [
    {insertText: {location: {index}, text}},
  ]);
}

export async function batchUpdate(
  accessToken: string,
  documentId: string,
  requests: Array<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const res = await fetch(
    `${DOCS_API}/${encodeURIComponent(documentId)}:batchUpdate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({requests}),
    },
  );
  if (!res.ok) throw new Error(`Docs batchUpdate failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}
