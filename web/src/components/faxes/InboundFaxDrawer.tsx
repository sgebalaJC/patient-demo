/**
 * Full-screen drawer for an inbound fax — extract & match (agent), DrChrono
 * attach/detach, email draft + send, internal notes, PDF preview, delete.
 *
 * Lifted out of AdminFaxesPage so the page is just the list + filters; the
 * drawer carries its own state/effects/handlers and is mounted via createPortal.
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { Timestamp } from 'firebase/firestore';
import {
  CheckCircle2,
  Copy,
  Paperclip,
  Send,
  Sparkles,
  Trash,
  X,
} from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { ConfirmModal } from '../ui/ConfirmModal';
import { functions } from '../../lib/firebase';
import { formatDateTime } from '../../lib/date-helpers';
import { errorMessage } from '../../lib/errors';
import { usePdfPreview } from '../../hooks/usePdfPreview';
import { BRANDING } from '../../config/branding';
import {
  FaxStatusChip,
  FAX_STATUS_BADGE,
  type ChipState,
  type FaxRowStatus,
} from './FaxStatusChip';

const AGENT_NAME = BRANDING.adminAgent.name;

export interface InboundFax {
  faxSid: string;
  receivedAt?: Timestamp | null;
  from?: string;
  to?: string;
  pageCount?: number;
  pdfPath?: string | null;
  status: FaxRowStatus;
  attempts?: number;
  lastError?: { message?: string } | null;
  aurelia?: {
    sessionId?: string;
    summary?: string;
    summaryForAdmin?: string;
    currentStep?: string;
    confidence?: number;
  } | null;
  matchedPatient?: {
    drchronoId?: number;
    patientId?: string;
    confidence?: string;
  } | null;
  extracted?: {
    patientName?: string;
    patientDob?: string;
    documentType?: string;
    senderProvider?: string;
  } | null;
  drchronoDocumentId?: number | null;
  emailMode?: 'draft_only' | 'auto_send';
  emailDraft?: {
    to: string;
    cc?: string[];
    subject: string;
    body: string;
    generatedAt?: Timestamp;
  } | null;
  emailSent?: {
    messageId: string;
    sentAt?: Timestamp;
    sentBy?: 'aurelia_auto' | 'admin_manual';
  } | null;
  notes?: string;
}

export function patientMatchState(fax: InboundFax): ChipState {
  if (!fax.matchedPatient) return { tone: 'pending', label: 'Not yet matched' };
  const c = fax.matchedPatient.confidence;
  if (c === 'exact') {
    return {
      tone: 'success',
      label: 'Patient matched',
      detail: fax.matchedPatient.drchronoId ? `DrChrono #${fax.matchedPatient.drchronoId}` : undefined,
    };
  }
  if (c === 'ambiguous') return { tone: 'warning', label: 'Multiple candidates', detail: 'Needs admin review' };
  if (c === 'none') return { tone: 'error', label: 'No patient found', detail: 'Needs manual match' };
  return { tone: 'pending', label: 'Not yet matched' };
}

export function drchronoUploadState(fax: InboundFax): ChipState {
  if (fax.drchronoDocumentId) {
    return { tone: 'success', label: 'Uploaded to chart', detail: `Document #${fax.drchronoDocumentId}` };
  }
  if (fax.matchedPatient?.confidence === 'none' || fax.matchedPatient?.confidence === 'ambiguous') {
    return { tone: 'warning', label: 'Skipped', detail: 'Awaiting patient confirmation' };
  }
  if (fax.aurelia?.currentStep === 'done' && !fax.drchronoDocumentId) {
    return { tone: 'error', label: 'Upload failed', detail: `Check ${AGENT_NAME} notes` };
  }
  return { tone: 'pending', label: 'Not yet uploaded' };
}

interface InboundFaxDrawerProps {
  fax: InboundFax;
  onClose: () => void;
}

export const InboundFaxDrawer: React.FC<InboundFaxDrawerProps> = ({ fax, onClose }) => {
  const navigate = useNavigate();
  const { url: pdfUrl, loading: pdfLoading, error: pdfError } = usePdfPreview(
    async () => {
      if (!fax.pdfPath) return null;
      const fn = httpsCallable(functions, 'getFaxPdfUrl');
      const res = (await fn({ faxSid: fax.faxSid })).data as { url: string };
      return res.url;
    },
    [fax.faxSid, fax.pdfPath],
  );
  const [draft, setDraft] = useState({
    to: fax.emailDraft?.to || '',
    subject: fax.emailDraft?.subject || '',
    body: fax.emailDraft?.body || '',
  });
  const [notes, setNotes] = useState(fax.notes || '');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDetachConfirm, setShowDetachConfirm] = useState(false);

  useEffect(() => {
    setDraft({
      to: fax.emailDraft?.to || '',
      subject: fax.emailDraft?.subject || '',
      body: fax.emailDraft?.body || '',
    });
    setNotes(fax.notes || '');
  }, [fax.faxSid, fax.emailDraft, fax.notes]);

  async function call(name: string, data: Record<string, unknown>, label: string): Promise<void> {
    setBusy(label);
    setMsg(null);
    try {
      const fn = httpsCallable(functions, name);
      await fn(data);
      setMsg({ kind: 'ok', text: `${label} succeeded` });
    } catch (err: unknown) {
      console.error(`${name} failed`, err);
      setMsg({ kind: 'err', text: errorMessage(err) || `${label} failed` });
    } finally {
      setBusy(null);
    }
  }

  const handleSaveDraft = () => call('updateFaxDraft', {
    faxSid: fax.faxSid,
    patch: { emailDraft: { to: draft.to, subject: draft.subject, body: draft.body }, notes },
  }, 'Save');

  const handleSend = () => call('sendFaxEmail', {
    faxSid: fax.faxSid,
    overrideDraft: { to: draft.to, subject: draft.subject, body: draft.body },
  }, 'Send email');

  const handleProcessWithAgent = async () => {
    setBusy('Process');
    setMsg(null);
    try {
      if (!pdfUrl) throw new Error('PDF not loaded yet');
      const res = await fetch(pdfUrl);
      if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);
      const blob = await res.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
          const result = r.result as string;
          resolve(result.includes(',') ? result.split(',')[1] : result);
        };
        r.onerror = reject;
        r.readAsDataURL(blob);
      });

      const prompt = `Fax \`${fax.faxSid}\` — extract + match only (do NOT upload to DrChrono).

From the attached PDF, extract patient name, DOB, document type, sending provider. Write a short patient-friendly summary and a longer internal summary. Search DrChrono for the patient. Draft the email.

Write results back via PATCH /admin-api/faxes/${fax.faxSid}. Include: \`extracted\`, \`matchedPatient\` (with \`drchronoId\` + \`confidence\`), \`aurelia.summary\`, \`aurelia.summaryForAdmin\`, \`aurelia.confidence\`, \`emailDraft\`, \`status: "needs_review"\`. Skip DrChrono upload — that's a separate button.`;

      sessionStorage.setItem('agent_prefill', JSON.stringify({
        message: prompt,
        attachment: {
          name: `fax-${fax.faxSid.slice(0, 8)}.pdf`,
          mimeType: 'application/pdf',
          base64,
        },
      }));
      navigate('/admin/agent');
    } catch (err: unknown) {
      console.error(`Process with ${AGENT_NAME} failed`, err);
      setMsg({ kind: 'err', text: errorMessage(err) || `Failed to prepare ${AGENT_NAME} task` });
      setBusy(null);
    }
  };

  const handleAttach = async () => {
    setBusy('Attach');
    setMsg(null);
    try {
      const fn = httpsCallable(functions, 'attachFaxToDrChrono');
      const res = (await fn({ faxSid: fax.faxSid })).data as {
        ok: boolean; alreadyAttached: boolean; drchronoDocumentId: number;
      };
      setMsg({
        kind: 'ok',
        text: res.alreadyAttached
          ? `Already attached (document #${res.drchronoDocumentId})`
          : `Attached to DrChrono (document #${res.drchronoDocumentId})`,
      });
    } catch (err: unknown) {
      console.error('attachFaxToDrChrono failed', err);
      setMsg({ kind: 'err', text: errorMessage(err) || 'Attach failed' });
    } finally {
      setBusy(null);
    }
  };

  const handleDetach = async () => {
    setShowDetachConfirm(false);
    setBusy('Detach');
    setMsg(null);
    try {
      const fn = httpsCallable(functions, 'detachFaxFromDrChrono');
      await fn({ faxSid: fax.faxSid });
      setMsg({ kind: 'ok', text: 'Detached — you can re-attach now' });
    } catch (err: unknown) {
      setMsg({ kind: 'err', text: errorMessage(err) || 'Detach failed' });
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    setShowDeleteConfirm(false);
    setBusy('Delete');
    setMsg(null);
    try {
      const fn = httpsCallable(functions, 'deleteFax');
      await fn({ faxSid: fax.faxSid });
      onClose();
    } catch (err: unknown) {
      console.error('deleteFax failed', err);
      setMsg({ kind: 'err', text: errorMessage(err) || 'Delete failed' });
      setBusy(null);
    }
  };

  const copy = (text: string) => navigator.clipboard.writeText(text).then(() =>
    setMsg({ kind: 'ok', text: 'Copied to clipboard' })
  );

  return createPortal(
    <div className="fixed inset-0 bg-black/60 z-50" onClick={onClose}>
      <div
        className="bg-secondary-50 w-full h-full overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-secondary-50/95 backdrop-blur border-b border-secondary-200 px-6 py-4 z-10">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-secondary-900 truncate">Fax {fax.faxSid.slice(0, 16)}…</h2>
              <p className="text-xs text-secondary-500 mt-0.5">
                From {fax.from || '—'} • {fax.pageCount || '?'} pages • Status: {FAX_STATUS_BADGE[fax.status].label}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
              <Button
                onClick={handleProcessWithAgent}
                disabled={!!busy || !pdfUrl}
                variant="secondary"
                className="!border-primary-600 !text-primary-700 hover:!bg-primary-50"
              >
                <Sparkles className="w-4 h-4 mr-1.5" />
                {busy === 'Process' ? 'Opening…' : 'Extract & Match'}
              </Button>
              {fax.drchronoDocumentId ? (
                <div className="flex items-center gap-1">
                  <Button
                    variant="secondary"
                    disabled
                    className="!text-emerald-600 dark:!text-emerald-400 !border-emerald-500/30"
                    title={`Attached to DrChrono as document #${fax.drchronoDocumentId}`}
                  >
                    <CheckCircle2 className="w-4 h-4 mr-1.5" />
                    Attached #{fax.drchronoDocumentId}
                  </Button>
                  <button
                    onClick={() => setShowDetachConfirm(true)}
                    disabled={!!busy}
                    title="Remove the PDF from the DrChrono chart (for testing / corrections)"
                    className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-lg"
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <Button
                  onClick={handleAttach}
                  variant="secondary"
                  disabled={!!busy || !fax.matchedPatient?.drchronoId}
                  title={fax.matchedPatient?.drchronoId
                    ? 'Upload PDF to matched DrChrono patient chart (one-time)'
                    : 'Run Extract & Match first to match a patient'}
                >
                  <Paperclip className="w-4 h-4 mr-1.5" />
                  {busy === 'Attach' ? 'Attaching…' : 'Attach to DrChrono'}
                </Button>
              )}
              <Button
                onClick={handleSend}
                variant="secondary"
                disabled={!!busy || !draft.to || !draft.subject || !draft.body}
              >
                <Send className="w-4 h-4 mr-1.5" />
                {busy === 'Send email' ? 'Sending…' : 'Send Email'}
              </Button>
              <button onClick={onClose} className="p-2 hover:bg-secondary-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-6 pb-6 pt-0 space-y-4">
          {msg && (
            <div className={`rounded-md px-4 py-2 text-sm border ${
              msg.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                                 : 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30'
            }`}>{msg.text}</div>
          )}

          {fax.lastError && (
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-md px-4 py-2 text-sm text-rose-700 dark:text-rose-300">
              <strong>Last error:</strong> {fax.lastError.message}
            </div>
          )}

          {/* Agent summary panel */}
          {fax.aurelia && (
            <Card className="p-4 bg-primary-50/40">
              <h3 className="text-sm font-semibold text-secondary-800 mb-2">{AGENT_NAME}</h3>
              {fax.aurelia.currentStep && (
                <p className="text-xs text-secondary-600 mb-2"><strong>Current step:</strong> {fax.aurelia.currentStep}</p>
              )}
              {typeof fax.aurelia.confidence === 'number' && (
                <p className="text-xs text-secondary-600 mb-2"><strong>Confidence:</strong> {(fax.aurelia.confidence * 100).toFixed(0)}%</p>
              )}
              {fax.aurelia.summaryForAdmin && (
                <div className="mt-2">
                  <p className="text-xs font-medium text-secondary-700 mb-1">Internal summary:</p>
                  <p className="text-sm text-secondary-800 whitespace-pre-wrap">{fax.aurelia.summaryForAdmin}</p>
                </div>
              )}
            </Card>
          )}

          {/* Processing status — visual chips for key outcomes */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold text-secondary-800 mb-3">Processing Status</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FaxStatusChip
                label="Patient match"
                state={patientMatchState(fax)}
              />
              <FaxStatusChip
                label="DrChrono document"
                state={drchronoUploadState(fax)}
              />
            </div>
          </Card>

          {/* Extracted */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold text-secondary-800 mb-3">Extracted Info</h3>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <dt className="text-secondary-500">Patient name</dt>
              <dd>{fax.extracted?.patientName || '—'}</dd>
              <dt className="text-secondary-500">DOB</dt>
              <dd>{fax.extracted?.patientDob || '—'}</dd>
              <dt className="text-secondary-500">Document type</dt>
              <dd>{fax.extracted?.documentType || '—'}</dd>
              <dt className="text-secondary-500">Sender</dt>
              <dd>{fax.extracted?.senderProvider || '—'}</dd>
              <dt className="text-secondary-500">DrChrono patient ID</dt>
              <dd>{fax.matchedPatient?.drchronoId || '—'}</dd>
              <dt className="text-secondary-500">DrChrono document ID</dt>
              <dd>{fax.drchronoDocumentId || '—'}</dd>
            </dl>
          </Card>

          {/* PDF preview */}
          {(pdfLoading || pdfUrl || pdfError) && (
            <Card className="p-2">
              {pdfLoading && (
                <div className="flex items-center justify-center h-[600px] text-secondary-500 text-sm gap-2">
                  <LoadingSpinner size="md" />
                  Loading PDF…
                </div>
              )}
              {!pdfLoading && pdfError && (
                <div className="flex items-center justify-center h-[600px] text-rose-600 text-sm">
                  {pdfError}
                </div>
              )}
              {!pdfLoading && pdfUrl && (
                <iframe src={pdfUrl} title="Fax PDF" className="w-full h-[600px] rounded" />
              )}
            </Card>
          )}

          {/* Email draft */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold text-secondary-800 mb-3">Email Draft</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-secondary-600">To (patient email)</label>
                <input
                  type="email"
                  value={draft.to}
                  onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                  className="input w-full mt-1 text-sm"
                  placeholder="patient@example.com"
                />
              </div>
              <div>
                <label className="text-xs text-secondary-600 flex items-center justify-between">
                  <span>Subject</span>
                  <button onClick={() => copy(draft.subject)} className="text-primary-600 hover:underline flex items-center gap-1">
                    <Copy className="w-3 h-3" /> Copy
                  </button>
                </label>
                <input
                  type="text"
                  value={draft.subject}
                  onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                  className="input w-full mt-1 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-secondary-600 flex items-center justify-between">
                  <span>Body</span>
                  <button onClick={() => copy(draft.body)} className="text-primary-600 hover:underline flex items-center gap-1">
                    <Copy className="w-3 h-3" /> Copy
                  </button>
                </label>
                <textarea
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  rows={16}
                  className="input w-full mt-1 text-sm font-mono resize-y overflow-y-auto leading-relaxed"
                  style={{ minHeight: '16rem', maxHeight: '32rem' }}
                />
              </div>
              <div>
                <label className="text-xs text-secondary-600">Internal notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="input w-full mt-1 text-sm"
                />
              </div>
            </div>
          </Card>

          {/* Secondary actions */}
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSaveDraft} disabled={!!busy} variant="secondary">
              {busy === 'Save' ? 'Saving…' : 'Save Draft'}
            </Button>
            <Button
              onClick={() => setShowDeleteConfirm(true)}
              variant="secondary"
              disabled={!!busy}
              className="!text-rose-600 dark:!text-rose-400 hover:!bg-rose-500/10 !border-rose-500/30"
            >
              <Trash className="w-4 h-4 mr-1.5" />
              {busy === 'Delete' ? 'Deleting…' : 'Delete'}
            </Button>
          </div>

          <ConfirmModal
            isOpen={showDeleteConfirm}
            onClose={() => setShowDeleteConfirm(false)}
            onConfirm={handleDelete}
            title="Delete this fax?"
            message={`Permanently delete fax ${fax.faxSid.slice(0, 16)}… including the PDF and all related notifications. This cannot be undone.`}
            confirmLabel="Delete Permanently"
            variant="danger"
          />

          <ConfirmModal
            isOpen={showDetachConfirm}
            onClose={() => setShowDetachConfirm(false)}
            onConfirm={handleDetach}
            title="Detach from DrChrono?"
            message={`Document #${fax.drchronoDocumentId} will be removed from the patient chart so you can re-attach.`}
            confirmLabel="Detach"
            variant="warning"
          />

          {fax.emailSent && (
            <div className="text-xs text-secondary-500 border-t pt-4">
              Email sent: {fax.emailSent.sentAt ? formatDateTime(fax.emailSent.sentAt.toDate()) : '—'}
              {' '}(via {fax.emailSent.sentBy}) · Message ID: <span className="font-mono">{fax.emailSent.messageId}</span>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
