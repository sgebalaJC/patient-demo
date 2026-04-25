/**
 * Patient-facing email draft panel for an inbound fax — to / subject / body
 * inputs + internal notes + Save Draft + Send Email buttons. Lifted out of
 * `InboundFaxDrawer` so the drawer carries fax metadata + chips + PDF +
 * delete, and this component owns the draft editing flow.
 *
 * The agent (when run via "Extract & Match") prefills the draft on the
 * Firestore doc; this component picks up `initialDraft` / `initialNotes`
 * from the parent and stays in sync if those props change (different fax
 * selected). All write paths are Cloud Functions — no Firestore writes
 * here.
 */

import React, { useEffect, useState } from 'react';
import { Copy, Send, Save } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { functions } from '../../lib/firebase';
import { errorMessage } from '../../lib/errors';

export interface FaxEmailDraftValues {
  to: string;
  subject: string;
  body: string;
}

interface FaxEmailDraftPanelProps {
  faxSid: string;
  initialDraft: FaxEmailDraftValues;
  initialNotes: string;
  onMessage: (msg: { kind: 'ok' | 'err'; text: string }) => void;
}

export const FaxEmailDraftPanel: React.FC<FaxEmailDraftPanelProps> = ({
  faxSid,
  initialDraft,
  initialNotes,
  onMessage,
}) => {
  const [draft, setDraft] = useState<FaxEmailDraftValues>(initialDraft);
  const [notes, setNotes] = useState(initialNotes);
  const [busy, setBusy] = useState<'save' | 'send' | null>(null);

  // Re-sync when the parent swaps in a different fax. Comparing on faxSid
  // alone is intentional — local edits to draft/notes shouldn't be wiped
  // every time the Firestore doc updates (e.g. status change).
  useEffect(() => {
    setDraft(initialDraft);
    setNotes(initialNotes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faxSid]);

  const copy = (text: string) =>
    navigator.clipboard.writeText(text).then(() =>
      onMessage({ kind: 'ok', text: 'Copied to clipboard' }),
    );

  const handleSave = async () => {
    setBusy('save');
    try {
      const fn = httpsCallable(functions, 'updateFaxDraft');
      await fn({
        faxSid,
        patch: { emailDraft: { to: draft.to, subject: draft.subject, body: draft.body }, notes },
      });
      onMessage({ kind: 'ok', text: 'Draft saved' });
    } catch (err: unknown) {
      console.error('updateFaxDraft failed', err);
      onMessage({ kind: 'err', text: errorMessage(err) || 'Save failed' });
    } finally {
      setBusy(null);
    }
  };

  const handleSend = async () => {
    setBusy('send');
    try {
      const fn = httpsCallable(functions, 'sendFaxEmail');
      await fn({
        faxSid,
        overrideDraft: { to: draft.to, subject: draft.subject, body: draft.body },
      });
      onMessage({ kind: 'ok', text: 'Email sent' });
    } catch (err: unknown) {
      console.error('sendFaxEmail failed', err);
      onMessage({ kind: 'err', text: errorMessage(err) || 'Send failed' });
    } finally {
      setBusy(null);
    }
  };

  const canSend = !!draft.to && !!draft.subject && !!draft.body && busy === null;

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-secondary-800 mb-3">Email Draft</h3>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-secondary-600">To (patient email)</label>
          <input
            type="email"
            value={draft.to}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
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
            onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
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
            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
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

      <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-secondary-200">
        <Button onClick={handleSave} disabled={busy !== null} variant="secondary">
          <Save className="w-4 h-4 mr-1.5" />
          {busy === 'save' ? 'Saving…' : 'Save Draft'}
        </Button>
        <Button onClick={handleSend} disabled={!canSend}>
          <Send className="w-4 h-4 mr-1.5" />
          {busy === 'send' ? 'Sending…' : 'Send Email'}
        </Button>
      </div>
    </Card>
  );
};
