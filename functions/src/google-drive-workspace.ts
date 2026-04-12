/**
 * Google Drive API helpers for the Google Workspace OAuth integration.
 * Used by the googleWorkspaceProxy Cloud Function.
 */

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: string | null;
  modifiedTime: string;
  webViewLink: string | null;
  parents: string[];
}

function parseFile(item: Record<string, unknown>): DriveFile {
  return {
    id: item.id as string,
    name: (item.name as string) || "(Untitled)",
    mimeType: (item.mimeType as string) || "application/octet-stream",
    size: (item.size as string) || null,
    modifiedTime: (item.modifiedTime as string) || "",
    webViewLink: (item.webViewLink as string) || null,
    parents: (item.parents as string[]) || [],
  };
}

export async function listFiles(
  accessToken: string,
  query?: string,
  maxResults = 20,
): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    pageSize: String(maxResults),
    fields: "files(id,name,mimeType,size,modifiedTime,webViewLink,parents)",
    orderBy: "modifiedTime desc",
  });
  if (query) params.set("q", query);
  const res = await fetch(`${DRIVE_API}/files?${params}`, {
    headers: {Authorization: `Bearer ${accessToken}`},
  });
  if (!res.ok) throw new Error(`Drive list failed: ${res.status}`);
  const data = await res.json();
  return ((data.files as Record<string, unknown>[]) ?? []).map(parseFile);
}

export async function getFile(
  accessToken: string,
  fileId: string,
): Promise<DriveFile | null> {
  const res = await fetch(
    `${DRIVE_API}/files/${fileId}?fields=id,name,mimeType,size,modifiedTime,webViewLink,parents`,
    {headers: {Authorization: `Bearer ${accessToken}`}},
  );
  if (!res.ok) return null;
  return parseFile(await res.json());
}

export async function getFileContent(
  accessToken: string,
  fileId: string,
): Promise<string> {
  const meta = await getFile(accessToken, fileId);
  if (!meta) throw new Error("File not found");

  let url: string;
  if (meta.mimeType.startsWith("application/vnd.google-apps.")) {
    const exportMime =
      meta.mimeType === "application/vnd.google-apps.spreadsheet"
        ? "text/csv"
        : "text/plain";
    url = `${DRIVE_API}/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`;
  } else {
    url = `${DRIVE_API}/files/${fileId}?alt=media`;
  }

  const res = await fetch(url, {
    headers: {Authorization: `Bearer ${accessToken}`},
  });
  if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);

  const text = await res.text();
  if (text.length > 50000) return text.slice(0, 50000) + "\n...[truncated]";
  return text;
}

const GOOGLE_APPS_CONVERSION: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

export async function createFile(
  accessToken: string,
  name: string,
  content: string,
  mimeType = "text/plain",
  folderId?: string,
): Promise<DriveFile> {
  const sourceContentType = GOOGLE_APPS_CONVERSION[mimeType] ?? mimeType;
  const metadata: Record<string, unknown> = {name, mimeType};
  if (folderId) metadata.parents = [folderId];

  const boundary = "showmd_boundary_" + Date.now();
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${sourceContentType}`,
    "",
    content,
    `--${boundary}--`,
  ].join("\r\n");

  const res = await fetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,webViewLink,parents`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive create failed (${res.status}): ${text}`);
  }
  return parseFile(await res.json());
}
