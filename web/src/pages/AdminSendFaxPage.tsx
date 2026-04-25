import React, { useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { functions, storage } from '../lib/firebase';
import { Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, deleteObject } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import {
  Send, Upload, X, FileText, Trash2,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { AccessDenied } from '../components/ui/AccessDenied';
import { EmptyState } from '../components/ui/EmptyState';
import { FIELD_LIMITS } from '../lib/validation';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { PaginationBar } from '../components/ui/PaginationBar';
import { formatDateTime } from '../lib/date-helpers';
import { normalizePhoneNumber, formatPhoneDisplay } from '../lib/phone';
import { isAdminRole } from '../lib/roles';
import { useSimulationMode } from '../hooks/useSimulationMode';
import { usePagedCollection } from '../hooks/usePagedCollection';
import { faxes as faxesApi } from '../lib/integrations';
import {
  outboundFaxTone,
  OUTBOUND_FAX_TONE_CLASS,
  OUTBOUND_FAX_TONE_ICON,
} from '../components/faxes/FaxStatusChip';
import { OutboundFaxDrawer, type OutboundFax } from '../components/faxes/OutboundFaxDrawer';
import { alert as modalAlert } from '../lib/modals';

export const AdminSendFaxPage: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { userProfile } = useAuth();
  const isAdmin = isAdminRole(userProfile?.role);
  const { enabled: simulated } = useSimulationMode();

  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitOk, setSubmitOk] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [coverIncluded, setCoverIncluded] = useState(true);
  const [coverTo, setCoverTo] = useState('');

  const paged = usePagedCollection<OutboundFax>({
    enabled: isAdmin,
    real: 'outbound-faxes',
    sim: 'simulation/faxes/outbound',
    orderField: 'submittedAt',
    pageSize: 10,
    mapDoc: (d) => ({ ...(d.data() as OutboundFax) }),
  });
  const recent = paged.rows;
  const [deleteTarget, setDeleteTarget] = useState<OutboundFax | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [previewFax, setPreviewFax] = useState<OutboundFax | null>(null);

  const toNormalized = useMemo(() => {
    try { return to ? normalizePhoneNumber(to) : ''; } catch { return ''; }
  }, [to]);

  const totalBytes = useMemo(() => files.reduce((s, f) => s + f.size, 0), [files]);
  const tooLarge = totalBytes > 20 * 1024 * 1024;
  const canSubmit = !!toNormalized && files.length > 0 && !tooLarge && !submitting;

  function onFilesChosen(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) continue;
      if (next.length >= 10) break;
      next.push(f);
    }
    setFiles(next);
    setSubmitError('');
    setSubmitOk('');
  }

  function removeFile(i: number) {
    setFiles(files.filter((_, idx) => idx !== i));
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError('');
    setSubmitOk('');

    if (simulated) {
      try {
        const res = await faxesApi.sendFax({ to: toNormalized, subject, fileCount: files.length });
        setSubmitOk(`Simulated fax queued — SID ${res.faxSid.slice(0, 16)}… (delivers in ~2s)`);
        setFiles([]);
        setSubject('');
        setTo('');
        setCoverTo('');
        paged.refresh();
      } catch (err: unknown) {
        setSubmitError(err?.message || 'Submit failed');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const batchId = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    const prefix = `admin/outbound-faxes/${batchId}/`;
    const paths: string[] = files.map((f, i) => {
      const safeName = f.name.replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'file.pdf';
      return `${prefix}${String(i).padStart(2, '0')}_${safeName}`;
    });

    try {
      // Upload all attachments in parallel — one-by-one was visibly slow at 5+ files.
      await Promise.all(
        files.map((f, i) =>
          uploadBytes(ref(storage, paths[i]), f, { contentType: 'application/pdf' }),
        ),
      );

      const fn = httpsCallable(functions, 'sendOutboundFax');
      const res = await fn({
        batchId, paths, to: toNormalized, subject,
        coverIncluded, coverTo: coverIncluded ? coverTo : '',
      });
      const data = res.data as { ok: boolean; faxSid: string; status: string };
      setSubmitOk(`Fax submitted (${data.status}) — SID ${data.faxSid.slice(0, 12)}…`);
      setFiles([]);
      setSubject('');
      setTo('');
      setCoverTo('');
      paged.refresh();
    } catch (err: unknown) {
      setSubmitError(err?.message || 'Submit failed');
      // Best-effort cleanup of any uploaded source files so we don't leak
      // orphans when the SignalWire submit rejects. Run in parallel.
      await Promise.all(
        paths.map((p) =>
          deleteObject(ref(storage, p)).catch(() => { /* ignore */ }),
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const fn = httpsCallable(functions, 'deleteOutboundFax');
      await fn({ faxSid: deleteTarget.faxSid });
      setDeleteTarget(null);
      paged.refresh();
    } catch (err: unknown) {
      void modalAlert({ tone: 'error', title: 'Delete failed', message: err?.message || String(err) });
    } finally {
      setDeleting(false);
    }
  }

  if (!isAdmin) return <AccessDenied />;

  return (
    <div className="space-y-6">
      {!embedded && (
        <PageHeader
          backTo="/admin"
          icon={Send}
          title="Send Fax"
          subtitle="Outbound fax via SignalWire — PDFs merge into one fax"
        />
      )}

      <Card className="p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-secondary-700 mb-1">
            Recipient fax number
          </label>
          <input
            type="tel"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="(555) 123-4567"
            className="input"
          />
          {toNormalized && (
            <p className="text-xs text-secondary-500 mt-1">
              Normalized: {formatPhoneDisplay(toNormalized)} ({toNormalized})
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-secondary-700 mb-1">
            Subject <span className="text-secondary-400 font-normal">(shown on cover sheet + saved with the fax)</span>
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={FIELD_LIMITS.messageSubject.max}
            placeholder="e.g. MRI Results for pt appointment Monday 4/20/26"
            className="input"
          />
        </div>

        <div className="rounded-lg border border-secondary-200 p-4 space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={coverIncluded}
              onChange={(e) => setCoverIncluded(e.target.checked)}
              className="h-4 w-4 accent-primary-600"
            />
            <div>
              <div className="text-sm font-medium text-secondary-800">Include cover sheet</div>
              <div className="text-xs text-secondary-500">
                Prepends a Dr. Blasko letterhead page with To / Fax / Subject / dynamic page count.
              </div>
            </div>
          </label>
          {coverIncluded && (
            <div>
              <label className="block text-xs font-medium text-secondary-700 mb-1">
                To <span className="text-secondary-400 font-normal">(recipient name on the cover, e.g. "Brian Belnap, DO")</span>
              </label>
              <input
                type="text"
                value={coverTo}
                onChange={(e) => setCoverTo(e.target.value)}
                maxLength={FIELD_LIMITS.coverName.max}
                placeholder="Brian Belnap, DO"
                className="input"
              />
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-secondary-700 mb-2">
            PDF attachments {files.length > 0 && `(${files.length}/10)`}
          </label>

          <label
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!isDragging) setIsDragging(true); }}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setIsDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
              onFilesChosen(e.dataTransfer.files);
            }}
            className={`flex items-center justify-center gap-2 border-2 border-dashed rounded-lg py-8 cursor-pointer transition-colors ${
              isDragging
                ? 'border-primary-500 bg-primary-50'
                : 'border-secondary-300 hover:border-primary-400 hover:bg-primary-50/30'
            }`}
          >
            <Upload className={`h-5 w-5 ${isDragging ? 'text-primary-600' : 'text-secondary-500'}`} />
            <span className="text-sm text-secondary-600">
              {isDragging
                ? 'Drop PDFs here'
                : 'Drag & drop PDFs or click to select (multiple allowed, merged into one fax)'}
            </span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="hidden"
              onChange={(e) => onFilesChosen(e.target.files)}
            />
          </label>

          {files.length > 0 && (
            <ul className="mt-3 space-y-2">
              {files.map((f, i) => (
                <li key={i} className="flex items-center justify-between rounded-md border border-secondary-200 bg-white px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 text-secondary-500 flex-shrink-0" />
                    <span className="text-sm text-secondary-800 truncate">{f.name}</span>
                    <span className="text-xs text-secondary-500 flex-shrink-0">
                      {(f.size / 1024).toFixed(0)} KB
                    </span>
                  </div>
                  <button
                    onClick={() => removeFile(i)}
                    className="text-secondary-400 hover:text-rose-600 p-1"
                    aria-label="Remove file"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {tooLarge && (
            <p className="text-xs text-rose-600 mt-2">
              Total upload {(totalBytes / 1024 / 1024).toFixed(1)} MB exceeds 20 MB limit.
            </p>
          )}
        </div>

        {submitError && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {submitError}
          </div>
        )}
        {submitOk && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            {submitOk}
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={handleSubmit} loading={submitting} disabled={!canSubmit}>
            <Send className="h-4 w-4 mr-2" /> Send fax
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-semibold text-secondary-900 mb-3">Recent outbound faxes</h2>
        {recent.length === 0 ? (
          <EmptyState
            inline
            icon={Send}
            title="No faxes sent yet"
            description="Outbound faxes will appear here with live delivery status."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-secondary-600 border-b border-secondary-200">
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">To</th>
                  <th className="py-2 pr-4 font-medium">Subject</th>
                  <th className="py-2 pr-4 font-medium">Pages</th>
                  <th className="py-2 pr-4 font-medium">Submitted</th>
                  <th className="py-2 pr-4 font-medium">Error</th>
                  <th className="py-2 pr-2 font-medium w-8"></th>
                </tr>
              </thead>
              <tbody>
                {recent.map((fax) => {
                  const tone = outboundFaxTone(fax.status);
                  const Icon = OUTBOUND_FAX_TONE_ICON[tone];
                  return (
                    <tr
                      key={fax.faxSid}
                      onClick={() => setPreviewFax(fax)}
                      className="border-b border-secondary-100 last:border-0 cursor-pointer hover:bg-secondary-50"
                    >
                      <td className="py-3 pr-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs ${OUTBOUND_FAX_TONE_CLASS[tone]}`}>
                          <Icon className="h-3 w-3" />
                          {fax.status}
                        </span>
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs text-secondary-700">
                        {formatPhoneDisplay(fax.to)}
                      </td>
                      <td className="py-3 pr-4 text-secondary-700 max-w-[220px] truncate">
                        {fax.subject || <span className="text-secondary-400">—</span>}
                      </td>
                      <td className="py-3 pr-4 text-secondary-700">
                        {fax.pageCount ?? <span className="text-secondary-400">—</span>}
                      </td>
                      <td className="py-3 pr-4 text-secondary-600 text-xs">
                        {fax.submittedAt ? formatDateTime(fax.submittedAt.toDate()) : '—'}
                      </td>
                      <td className="py-3 pr-4 text-xs text-rose-600 max-w-[180px] truncate">
                        {fax.errorMessage || (fax.errorCode ? `Code ${fax.errorCode}` : '')}
                      </td>
                      <td className="py-3 pr-2 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(fax); }}
                          title="Delete this row + cleanup PDFs"
                          className="p-1.5 rounded text-secondary-400 hover:text-rose-600 hover:bg-rose-50"
                          aria-label="Delete outbound fax"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {(recent.length > 0 || paged.page > 1) && (
          <div className="mt-3">
            <PaginationBar
              currentPage={paged.page}
              pageSize={paged.pageSize}
              totalItems={(paged.page - 1) * paged.pageSize + recent.length + (paged.hasNext ? 1 : 0)}
              hasMore={paged.hasNext}
              onPreviousPage={paged.prev}
              onNextPage={paged.next}
              label="faxes"
            />
          </div>
        )}
      </Card>

      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => (deleting ? null : setDeleteTarget(null))}
        onConfirm={handleConfirmDelete}
        title="Delete this outbound fax?"
        message={
          deleteTarget
            ? `Removes the row and the merged PDF + source files from storage. The fax itself was already submitted to SignalWire and can't be unsent. This cannot be undone.`
            : ''
        }
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        variant="danger"
      />

      {previewFax && (
        <OutboundFaxDrawer fax={previewFax} onClose={() => setPreviewFax(null)} />
      )}
    </div>
  );
};
