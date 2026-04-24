/**
 * Google Sheets API helpers for the Google Workspace integration.
 * Used by the googleWorkspaceProxy Cloud Function.
 *
 * Scope: https://www.googleapis.com/auth/spreadsheets (read + write).
 * Exposed through the agent's google-workspace skill under {service:
 * "sheets", action: "..."}. See the skill for the read-before-write
 * workflow and the `values` (array-of-arrays) data-format rule.
 */

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

export interface SheetTab {
  sheetId: number;
  title: string;
  rowCount: number;
  columnCount: number;
  frozenRows: number;
  frozenColumns: number;
}

export interface SheetMetadata {
  spreadsheetId: string;
  title: string;
  sheets: SheetTab[];
}

export async function getMetadata(
  accessToken: string,
  spreadsheetId: string,
): Promise<SheetMetadata> {
  const res = await fetch(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,properties.title,sheets.properties`,
    {headers: {Authorization: `Bearer ${accessToken}`}},
  );
  if (!res.ok) throw new Error(`Sheets metadata failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as {
    spreadsheetId: string;
    properties: {title: string};
    sheets: Array<{properties: {sheetId: number; title: string; gridProperties: {rowCount: number; columnCount: number; frozenRowCount?: number; frozenColumnCount?: number}}}>;
  };
  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties?.title ?? "",
    sheets: (data.sheets ?? []).map((s) => ({
      sheetId: s.properties.sheetId,
      title: s.properties.title,
      rowCount: s.properties.gridProperties?.rowCount ?? 0,
      columnCount: s.properties.gridProperties?.columnCount ?? 0,
      frozenRows: s.properties.gridProperties?.frozenRowCount ?? 0,
      frozenColumns: s.properties.gridProperties?.frozenColumnCount ?? 0,
    })),
  };
}

export async function getValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
): Promise<string[][]> {
  const res = await fetch(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
    {headers: {Authorization: `Bearer ${accessToken}`}},
  );
  if (!res.ok) throw new Error(`Sheets get failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as {values?: string[][]};
  return data.values ?? [];
}

export async function setValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  values: string[][],
): Promise<{updatedRange: string; updatedRows: number; updatedColumns: number}> {
  const res = await fetch(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({values}),
    },
  );
  if (!res.ok) throw new Error(`Sheets setValues failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as {updatedRange: string; updatedRows: number; updatedColumns: number};
  return {
    updatedRange: data.updatedRange,
    updatedRows: data.updatedRows ?? 0,
    updatedColumns: data.updatedColumns ?? 0,
  };
}

export async function appendValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  values: string[][],
): Promise<{appendedRange: string | null}> {
  const res = await fetch(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({values}),
    },
  );
  if (!res.ok) throw new Error(`Sheets append failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as {updates?: {updatedRange?: string}};
  return {appendedRange: data.updates?.updatedRange ?? null};
}

export async function clearValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
): Promise<void> {
  const res = await fetch(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`,
    {
      method: "POST",
      headers: {Authorization: `Bearer ${accessToken}`},
    },
  );
  if (!res.ok) throw new Error(`Sheets clear failed (${res.status}): ${await res.text()}`);
}

/**
 * Replace an entire tab: clears the named tab, then writes `values` to A1.
 * Use when the agent wants to rewrite the whole sheet — safer than a raw
 * setValues on a huge range since it guarantees no stale cells linger.
 */
export async function replaceSheet(
  accessToken: string,
  spreadsheetId: string,
  tabTitle: string,
  values: string[][],
): Promise<{updatedRange: string}> {
  await clearValues(accessToken, spreadsheetId, tabTitle);
  const result = await setValues(accessToken, spreadsheetId, `${tabTitle}!A1`, values);
  return {updatedRange: result.updatedRange};
}

export async function batchUpdate(
  accessToken: string,
  spreadsheetId: string,
  requests: Array<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const res = await fetch(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({requests}),
    },
  );
  if (!res.ok) throw new Error(`Sheets batchUpdate failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}

// ─── Convenience wrappers on top of batchUpdate ───────────────────────

export async function addSheet(
  accessToken: string,
  spreadsheetId: string,
  title: string,
): Promise<number> {
  const result = await batchUpdate(accessToken, spreadsheetId, [
    {addSheet: {properties: {title}}},
  ]);
  const replies = (result.replies ?? []) as Array<{addSheet?: {properties?: {sheetId?: number}}}>;
  return replies[0]?.addSheet?.properties?.sheetId ?? 0;
}

export async function deleteSheetByTitle(
  accessToken: string,
  spreadsheetId: string,
  title: string,
): Promise<void> {
  const meta = await getMetadata(accessToken, spreadsheetId);
  const tab = meta.sheets.find((s) => s.title === title);
  if (!tab) throw new Error(`Sheet tab '${title}' not found`);
  await batchUpdate(accessToken, spreadsheetId, [
    {deleteSheet: {sheetId: tab.sheetId}},
  ]);
}

export async function renameSheet(
  accessToken: string,
  spreadsheetId: string,
  oldTitle: string,
  newTitle: string,
): Promise<void> {
  const meta = await getMetadata(accessToken, spreadsheetId);
  const tab = meta.sheets.find((s) => s.title === oldTitle);
  if (!tab) throw new Error(`Sheet tab '${oldTitle}' not found`);
  await batchUpdate(accessToken, spreadsheetId, [
    {
      updateSheetProperties: {
        properties: {sheetId: tab.sheetId, title: newTitle},
        fields: "title",
      },
    },
  ]);
}

export async function autoResize(
  accessToken: string,
  spreadsheetId: string,
  tabTitle = "Sheet1",
  startIndex = 0,
  endIndex?: number,
): Promise<void> {
  const meta = await getMetadata(accessToken, spreadsheetId);
  const tab = meta.sheets.find((s) => s.title === tabTitle);
  if (!tab) throw new Error(`Sheet tab '${tabTitle}' not found`);
  await batchUpdate(accessToken, spreadsheetId, [
    {
      autoResizeDimensions: {
        dimensions: {
          sheetId: tab.sheetId,
          dimension: "COLUMNS",
          startIndex,
          endIndex: endIndex ?? tab.columnCount,
        },
      },
    },
  ]);
}
