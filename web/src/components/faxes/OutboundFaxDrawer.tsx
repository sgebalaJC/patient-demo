/**
 * Right-side drawer that previews a sent outbound fax — submission metadata
 * plus the merged PDF rendered inline. Lifted out of AdminSendFaxPage so the
 * page stays focused on submission state and the recent-faxes table.
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Card } from '../ui/Card';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { functions } from '../../lib/firebase';
import { formatDateTime } from '../../lib/date-helpers';
import { formatPhoneDisplay } from '../../lib/phone';
import { usePdfPreview } from '../../hooks/usePdfPreview';

export interface OutboundFax {
  faxSid: string;
  to: string;
  from: string;
  subject?: string | null;
  pageCount?: number | null;
  fileCount?: number;
  status: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  submittedBy: string;
  submittedAt?: Timestamp | null;
  completedAt?: Timestamp | null;
}

interface OutboundFaxDrawerProps {
  fax: OutboundFax;
  onClose: () => void;
}

export const OutboundFaxDrawer: React.FC<OutboundFaxDrawerProps> = ({ fax, onClose }) => {
  const { url: pdfUrl, loading, error: loadError } = usePdfPreview(
    async () => {
      const fn = httpsCallable(functions, 'getFaxPdfUrl');
      const res = (await fn({ faxSid: fax.faxSid })).data as { url: string };
      return res.url;
    },
    [fax.faxSid],
  );

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-3xl bg-surface-card overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-secondary-50/95 backdrop-blur border-b border-secondary-200 px-6 py-4 z-10 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-secondary-900 truncate">
              Fax {fax.faxSid.slice(0, 16)}…
            </h2>
            <p className="text-xs text-secondary-500 mt-0.5">
              To {formatPhoneDisplay(fax.to)} • {fax.pageCount ?? '?'} pages • Status: {fax.status}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-secondary-100 rounded-lg" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <Card className="p-4">
            <h3 className="text-sm font-semibold text-secondary-900 mb-2">Submission</h3>
            <dl className="grid grid-cols-[140px_1fr] gap-y-1.5 text-sm">
              <dt className="text-secondary-500">Subject</dt>
              <dd className="text-secondary-900">{fax.subject || <span className="text-secondary-400">—</span>}</dd>
              <dt className="text-secondary-500">Submitted</dt>
              <dd className="text-secondary-900">{fax.submittedAt ? formatDateTime(fax.submittedAt.toDate()) : '—'}</dd>
              <dt className="text-secondary-500">Completed</dt>
              <dd className="text-secondary-900">{fax.completedAt ? formatDateTime(fax.completedAt.toDate()) : '—'}</dd>
              <dt className="text-secondary-500">From</dt>
              <dd className="text-secondary-900 font-mono text-xs">{fax.from || '—'}</dd>
              <dt className="text-secondary-500">Files</dt>
              <dd className="text-secondary-900">{fax.fileCount ?? '—'}</dd>
              {(fax.errorCode || fax.errorMessage) && (
                <>
                  <dt className="text-secondary-500">Error</dt>
                  <dd className="text-rose-600">{fax.errorMessage || `Code ${fax.errorCode}`}</dd>
                </>
              )}
            </dl>
          </Card>

          <Card className="p-4">
            <h3 className="text-sm font-semibold text-secondary-900 mb-2">Merged PDF</h3>
            {loading && (
              <div className="flex items-center justify-center h-[700px] text-secondary-500 text-sm gap-2 border border-secondary-200 rounded">
                <LoadingSpinner size="md" />
                Loading PDF…
              </div>
            )}
            {!loading && loadError && (
              <div className="flex items-center justify-center h-[700px] text-rose-600 text-sm border border-rose-200 rounded">
                {loadError}
              </div>
            )}
            {!loading && !loadError && pdfUrl && (
              <iframe src={pdfUrl} title="Outbound fax PDF" className="w-full h-[700px] rounded border border-secondary-200" />
            )}
          </Card>
        </div>
      </div>
    </div>,
    document.body,
  );
};
