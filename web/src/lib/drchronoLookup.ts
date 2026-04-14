/**
 * DrChrono CSV lookup — client-side helpers.
 * - Parses uploads (JSON array or CSV text).
 * - Kicks off a server-side job via a callable.
 * - Subscribes to job + rows for live progress.
 */

import { httpsCallable } from 'firebase/functions';
import {
  collection, doc, onSnapshot, orderBy, query, deleteDoc, Timestamp,
} from 'firebase/firestore';
import { db, functions } from './firebase';

export type RowStatus =
  | 'pending'
  | 'processing'
  | 'matched'
  | 'no-match'
  | 'skipped-multi'
  | 'no-email'
  | 'error';

export interface LookupRow {
  id: string;
  index: number;
  firstName: string;
  lastName: string;
  rawName: string;
  usefNo: string | null;
  isPrivate: boolean;
  status: RowStatus;
  email: string | null;
  drchronoId: number | null;
  candidatesCount: number | null;
  exactMatchesCount: number | null;
  errorMessage: string | null;
  processedAt: Timestamp | null;
}

export interface LookupJob {
  id: string;
  createdBy: string;
  createdByName: string;
  sourceFilename: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  totalRows: number;
  processedRows: number;
  matchedRows: number;
  noMatchRows: number;
  skippedRows: number;
  noEmailRows: number;
  errorRows: number;
  entitySkippedRows: number;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  startedAt: Timestamp | null;
  completedAt: Timestamp | null;
  error: string | null;
}

export interface ParsedUploadRow {
  firstName?: string;
  lastName?: string;
  name?: string;
  lfName?: string;
  usefNo?: string;
  isPrivate?: boolean;
}

/**
 * Parse an uploaded file. Accepts:
 *  - JSON array of objects ({ name, lf_name, people_id, usef_no, is_private }) — USEF format
 *  - CSV with a header row. Columns recognized (case-insensitive, spaces/underscores interchangeable):
 *    firstName/first_name, lastName/last_name, name, lfName/lf_name, usefNo/usef_no, isPrivate/is_private
 */
export function parseUpload(_filename: string, text: string): ParsedUploadRow[] {
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const data = JSON.parse(trimmed);
    const arr = Array.isArray(data) ? data : [data];
    return arr.map((r: Record<string, unknown>) => ({
      name: strOrUndef(r.name),
      lfName: strOrUndef(r.lf_name ?? r.lfName),
      firstName: strOrUndef(r.firstName ?? r.first_name),
      lastName: strOrUndef(r.lastName ?? r.last_name),
      usefNo: strOrUndef(r.usef_no ?? r.usefNo),
      isPrivate: boolOrUndef(r.is_private ?? r.isPrivate),
    }));
  }
  return parseCsv(trimmed);
}

function strOrUndef(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function boolOrUndef(v: unknown): boolean | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes') return true;
  if (s === '0' || s === 'false' || s === 'no') return false;
  return undefined;
}

function parseCsv(text: string): ParsedUploadRow[] {
  // Minimal CSV parser with quoted-field support. Good enough for well-formed
  // exports; refuses to pretend it handles embedded newlines in quoted fields.
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[\s_]/g, ''));
  const idxOf = (names: string[]) => names.map((n) => header.indexOf(n.toLowerCase().replace(/[\s_]/g, ''))).find((i) => i >= 0) ?? -1;

  const col = {
    firstName: idxOf(['firstName', 'first_name', 'fname']),
    lastName: idxOf(['lastName', 'last_name', 'lname']),
    name: idxOf(['name', 'fullname', 'full_name']),
    lfName: idxOf(['lfName', 'lf_name']),
    usefNo: idxOf(['usefNo', 'usef_no', 'usef']),
    isPrivate: idxOf(['isPrivate', 'is_private', 'private']),
  };

  const out: ParsedUploadRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    out.push({
      firstName: col.firstName >= 0 ? cells[col.firstName]?.trim() : undefined,
      lastName: col.lastName >= 0 ? cells[col.lastName]?.trim() : undefined,
      name: col.name >= 0 ? cells[col.name]?.trim() : undefined,
      lfName: col.lfName >= 0 ? cells[col.lfName]?.trim() : undefined,
      usefNo: col.usefNo >= 0 ? cells[col.usefNo]?.trim() : undefined,
      isPrivate: col.isPrivate >= 0 ? boolOrUndef(cells[col.isPrivate]) : undefined,
    });
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"') inQuotes = true;
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// ─── Callable / Firestore helpers ───────────────────────────────────

export async function startLookup(
  rows: ParsedUploadRow[],
  filename: string,
): Promise<{ jobId: string; totalRows: number; entitySkipped: number }> {
  const fn = httpsCallable<
    { rows: ParsedUploadRow[]; filename: string },
    { jobId: string; totalRows: number; entitySkipped: number }
  >(functions, 'drchronoLookupStart');
  const result = await fn({ rows, filename });
  return result.data;
}

export function subscribeJob(
  jobId: string,
  onJob: (job: LookupJob | null) => void,
): () => void {
  const ref = doc(db, 'drchrono-lookups', jobId);
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) { onJob(null); return; }
    onJob({ id: snap.id, ...(snap.data() as Omit<LookupJob, 'id'>) });
  });
}

export function subscribeRows(
  jobId: string,
  onRows: (rows: LookupRow[]) => void,
): () => void {
  const q = query(
    collection(db, 'drchrono-lookups', jobId, 'rows'),
    orderBy('index', 'asc'),
  );
  return onSnapshot(q, (snap) => {
    onRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LookupRow, 'id'>) })));
  });
}

export async function deleteLookup(jobId: string): Promise<void> {
  // Admin delete removes the top-level doc. The subcollection stays in
  // Firestore but is orphaned; admin cleanup is a separate concern.
  await deleteDoc(doc(db, 'drchrono-lookups', jobId));
}

// ─── Utility: entity detection (mirrors the server filter for preview) ───

const ENTITY_RE = /\b(LLC|INC|LTD|LIMITED|CORP|CO|FARM|FARMS|STABLES?|EQUINE|PARTNERS|VENTURES?|HORSES?|ENTERPRISES?|TRUST|HOLDINGS?|GROUP|ASSOCIATES?)\b/i;

export function looksLikeEntity(row: ParsedUploadRow): boolean {
  const name = (row.name || '').toUpperCase();
  const lf = (row.lfName || '').toUpperCase();
  if (name && lf && name === lf) return true;
  if (ENTITY_RE.test(name) || ENTITY_RE.test(lf)) return true;
  const f = (row.firstName || '').toUpperCase();
  const l = (row.lastName || '').toUpperCase();
  return ENTITY_RE.test(f) || ENTITY_RE.test(l);
}

export function displayName(row: ParsedUploadRow): string {
  if (row.firstName || row.lastName) return `${row.firstName || ''} ${row.lastName || ''}`.trim();
  return row.name || row.lfName || '(no name)';
}
