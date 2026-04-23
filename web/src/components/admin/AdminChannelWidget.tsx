import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, Send, X, Volume2, VolumeX, Bell, Maximize2, Minimize2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useFirestoreListener } from '../../hooks/useFirestoreListener';
import { isAdminRole } from '../../lib/roles';
import { formatDateTime } from '../../lib/date-helpers';
import { BRANDING } from '../../config/branding';
import {
  subscribeAdminChannel,
  sendAdminChannelMessage,
  type AdminChannelMessage,
} from '../../lib/firestore/admin-channel';

const MUTE_KEY = 'admin-channel-muted';
const LAST_SEEN_KEY = 'admin-channel-last-seen';
const NOTIFY_KEY = 'admin-channel-notify-asked';
const MAX_MESSAGES = 100;
const ORIGINAL_TITLE = typeof document !== 'undefined' ? document.title : BRANDING.shortName;

function playChime(): void {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const beep = (freq: number, startOffset: number, duration: number, peak = 0.45) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + startOffset;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    };
    beep(523.25, 0.00, 0.18);
    beep(659.25, 0.18, 0.18);
    beep(783.99, 0.36, 0.18);
    beep(1046.50, 0.54, 0.45, 0.5);
    setTimeout(() => { try { ctx.close(); } catch { /* ignore */ } }, 1400);
  } catch {
    /* ignore */
  }
}

export const AdminChannelWidget: React.FC = () => {
  const { user, userProfile } = useAuth();
  const isAdmin = isAdminRole(userProfile?.role);

  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [muted, setMuted] = useState<boolean>(() => localStorage.getItem(MUTE_KEY) === '1');
  const [lastSeenAt, setLastSeenAt] = useState<number>(() => {
    const s = localStorage.getItem(LAST_SEEN_KEY);
    return s ? parseInt(s, 10) || 0 : 0;
  });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const firstLoadRef = useRef(true);
  const messagesRef = useRef<AdminChannelMessage[]>([]);
  const titleFlashTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const windowFocusedRef = useRef<boolean>(
    typeof document !== 'undefined' ? document.hasFocus() : true,
  );

  // Live subscription. `new-message` side-effects (chime / title flash / OS
  // notification) run inside an effect on the latest snapshot so the
  // subscription itself stays pure data.
  const { data: messages = [] } = useFirestoreListener<AdminChannelMessage[]>(
    (onData, onError) => subscribeAdminChannel(MAX_MESSAGES, onData, onError),
    { enabled: isAdmin, initial: [], deps: [isAdmin] },
  );

  useEffect(() => {
    const prev = messagesRef.current;
    if (!firstLoadRef.current && messages.length > 0) {
      const latest = messages[messages.length - 1];
      const prevLatestId = prev.length ? prev[prev.length - 1].id : null;
      const isGenuinelyNew = latest.id !== prevLatestId;
      const isOwnMessage = latest.senderId === user?.uid;
      if (isGenuinelyNew && !isOwnMessage) {
        if (!muted) playChime();
        maybeShowOsNotification(latest);
        flashTitle();
        setOpen(true);
      }
    }
    firstLoadRef.current = false;
    messagesRef.current = messages;
  }, [messages, user?.uid, muted]);

  useEffect(() => {
    const onFocus = () => {
      windowFocusedRef.current = true;
      restoreTitle();
    };
    const onBlur = () => {
      windowFocusedRef.current = false;
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'default') return;
    if (localStorage.getItem(NOTIFY_KEY) === '1') return;
    localStorage.setItem(NOTIFY_KEY, '1');
    Notification.requestPermission().catch(() => { /* ignore */ });
  }, [isAdmin]);

  function maybeShowOsNotification(msg: AdminChannelMessage): void {
    if (windowFocusedRef.current) return;
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    try {
      const n = new Notification(`${msg.senderName || 'Admin'} — ${BRANDING.shortName}`, {
        body: msg.text.slice(0, 140),
        tag: 'admin-channel',
      });
      n.onclick = () => { window.focus(); n.close(); };
    } catch { /* ignore */ }
  }

  function flashTitle(): void {
    if (windowFocusedRef.current) return;
    if (titleFlashTimer.current) return;
    let on = false;
    titleFlashTimer.current = setInterval(() => {
      on = !on;
      document.title = on ? '💬 New admin message' : ORIGINAL_TITLE;
    }, 1000);
  }
  function restoreTitle(): void {
    if (titleFlashTimer.current) {
      clearInterval(titleFlashTimer.current);
      titleFlashTimer.current = null;
    }
    document.title = ORIGINAL_TITLE;
  }

  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, messages.length]);

  useEffect(() => {
    if (!open || messages.length === 0) return;
    const latest = messages[messages.length - 1];
    const latestMs = latest.createdAt ? latest.createdAt.toMillis() : Date.now();
    setLastSeenAt(latestMs);
    localStorage.setItem(LAST_SEEN_KEY, String(latestMs));
    restoreTitle();
  }, [open, messages]);

  const unreadCount = useMemo(() => {
    if (open) return 0;
    return messages.reduce((acc, m) => {
      if (m.senderId === user?.uid) return acc;
      const ms = m.createdAt ? m.createdAt.toMillis() : 0;
      return ms > lastSeenAt ? acc + 1 : acc;
    }, 0);
  }, [messages, lastSeenAt, open, user?.uid]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || !user || !userProfile || sending) return;
    if (text.length > 2000) return;
    setSending(true);
    const senderName =
      [userProfile.firstName, userProfile.lastName].filter(Boolean).join(' ').trim() ||
      userProfile.email ||
      'Admin';
    try {
      await sendAdminChannelMessage(user.uid, senderName, text);
      setDraft('');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('admin-channel send failed', err);
    } finally {
      setSending(false);
    }
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  }

  if (!isAdmin) return null;

  return (
    <div className="fixed bottom-1 right-1 z-50 flex flex-col items-end gap-2">
      {open && (
        <div
          className={
            expanded
              ? 'fixed inset-2 z-50 bg-surface-card rounded-xl shadow-2xl border border-secondary-200 flex flex-col overflow-hidden'
              : 'w-80 sm:w-96 h-[520px] bg-surface-card rounded-xl shadow-2xl border border-secondary-200 flex flex-col overflow-hidden'
          }
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-secondary-200 bg-surface-elevated">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-primary-600" />
              <span className="font-semibold text-secondary-900">Admin Channel</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={toggleMute}
                title={muted ? 'Unmute sound' : 'Mute sound'}
                className="p-1.5 rounded hover:bg-primary-100 text-secondary-600"
              >
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <button
                onClick={() => setExpanded((v) => !v)}
                title={expanded ? 'Collapse' : 'Expand'}
                className="p-1.5 rounded hover:bg-primary-100 text-secondary-600"
              >
                {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              <button
                onClick={() => setOpen(false)}
                title="Close"
                className="p-1.5 rounded hover:bg-primary-100 text-secondary-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2 bg-secondary-50">
            {messages.length === 0 ? (
              <div className="text-center text-sm text-secondary-500 py-8">
                No messages yet. Send one to get the room started.
              </div>
            ) : (
              messages.map((m) => {
                const mine = m.senderId === user?.uid;
                return (
                  <div
                    key={m.id}
                    className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                        mine
                          ? 'bg-primary-600 text-white rounded-br-sm'
                          : 'bg-secondary-100 border border-secondary-200 text-secondary-900 rounded-bl-sm'
                      }`}
                    >
                      {!mine && (
                        <div className="text-[11px] font-semibold text-primary-700 mb-0.5">
                          {m.senderName || 'Admin'}
                        </div>
                      )}
                      {m.text}
                    </div>
                    <div className="text-[10px] text-secondary-400 mt-0.5 px-1">
                      {m.createdAt ? formatDateTime(m.createdAt.toDate()) : 'sending…'}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-secondary-200 p-2 flex items-end gap-2 bg-surface-elevated">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Message the admin channel — Enter to send, Shift+Enter for newline"
              rows={2}
              maxLength={2000}
              className="flex-1 resize-none rounded-md border border-secondary-300 bg-surface-card text-secondary-900 px-3 py-2 text-sm focus:outline-none focus:border-primary-500"
            />
            <button
              onClick={handleSend}
              disabled={!draft.trim() || sending}
              className="rounded-md bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-2 flex items-center justify-center"
              title="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="relative h-12 w-12 rounded-full bg-primary-600 hover:bg-primary-700 text-white shadow-lg flex items-center justify-center transition-transform hover:scale-105"
        title="Admin channel"
      >
        {unreadCount > 0 && !open ? (
          <Bell className="h-5 w-5 animate-[pulse_1.2s_ease-in-out_infinite]" />
        ) : (
          <MessageCircle className="h-5 w-5" />
        )}
        {unreadCount > 0 && !open && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-rose-500 text-white text-[11px] font-semibold flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
};
