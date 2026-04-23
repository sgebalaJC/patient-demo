/**
 * Google Calendar — appointment sync.
 *
 * Creates / updates / deletes calendar events mirroring Firestore
 * `appointments`, and polls for changes in the other direction. All calls
 * go through `integrations/google-workspace` — the chosen calendar id and
 * auth mode (service-account impersonation OR OAuth as a specific email)
 * come from that doc. Env vars GOOGLE_CALENDAR_ID / GOOGLE_SA_KEY /
 * GOOGLE_CALENDAR_SUBJECT are retired; set it all via the admin UI.
 *
 * Event title format keeps the patient phone number so the downstream
 * appointment-reminder SMS job can parse it: "{firstName} {lastName} {phone}".
 */

import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import {
  loadIntegration,
  resolveAccessToken,
  type GoogleWorkspaceIntegration,
} from './google-workspace.js';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const db = admin.firestore();

// ── Shared integration resolver ────────────────────────────────────────

interface CalendarBinding {
  accessToken: string;
  calendarId: string;
}

/**
 * Returns bearer token + calendar id, or null if the integration is not
 * configured / disabled / missing its calendar id. Callers no-op on null
 * so a fork without Google Workspace set up doesn't error — it just skips.
 */
async function bind(): Promise<CalendarBinding | null> {
  let integration: GoogleWorkspaceIntegration | null;
  try {
    integration = await loadIntegration();
  } catch (err: any) {
    logger.error('Failed to load Google Workspace integration:', err.message);
    return null;
  }
  if (!integration || integration.status !== 'active' || !integration.calendarId) return null;
  if (!integration.enabledServices?.includes('calendar')) return null;
  try {
    const { accessToken } = await resolveAccessToken(integration);
    return { accessToken, calendarId: integration.calendarId };
  } catch (err: any) {
    logger.error('Failed to resolve Google access token:', err.message);
    return null;
  }
}

// ── Event payload builder (shared by create + update) ──────────────────

interface AppointmentInput {
  id: string;
  appointmentDate: admin.firestore.Timestamp;
  duration?: number;
  appointmentType?: string;
  reason?: string;
  notes?: string;
  status: string;
  reminderMessage?: string;
  address?: string;
  specialistType?: string;
}

function buildEventBody(
  appointment: AppointmentInput,
  patientName: string,
  patientPhone: string,
): Record<string, unknown> {
  const startDate = appointment.appointmentDate.toDate();
  const durationMinutes = appointment.duration || 20;
  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

  const summary = `${patientName} ${patientPhone}`;

  let description: string;
  if (appointment.reminderMessage) {
    description = appointment.reminderMessage;
  } else {
    const parts: string[] = [];
    if (appointment.appointmentType) parts.push(appointment.appointmentType);
    if (appointment.reason) parts.push(`Reason: ${appointment.reason}`);
    if (appointment.notes) parts.push(`Notes: ${appointment.notes}`);
    description = parts.length > 0
      ? parts.join('\n')
      : `${appointment.appointmentType || 'Appointment'}`;
  }

  return {
    summary,
    description,
    ...(appointment.address ? { location: appointment.address } : {}),
    start: { dateTime: startDate.toISOString(), timeZone: 'America/Los_Angeles' },
    end: { dateTime: endDate.toISOString(), timeZone: 'America/Los_Angeles' },
    extendedProperties: {
      private: { firestoreId: appointment.id, source: 'patient-portal' },
    },
  };
}

// ── Public API — unchanged signatures so index.ts callers are untouched.

export async function createCalendarEvent(
  appointment: AppointmentInput,
  patientName: string,
  patientPhone: string,
): Promise<string | null> {
  const b = await bind();
  if (!b) return null;
  try {
    const res = await fetch(
      `${CALENDAR_API}/calendars/${encodeURIComponent(b.calendarId)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${b.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildEventBody(appointment, patientName, patientPhone)),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.error('Calendar create failed', { status: res.status, body: text.slice(0, 200) });
      return null;
    }
    const data = await res.json();
    logger.info(`Calendar event created: ${data.id} for appointment ${appointment.id}`);
    return (data.id as string) || null;
  } catch (error: any) {
    logger.error('Error creating calendar event:', { message: error.message });
    return null;
  }
}

export async function updateCalendarEvent(
  eventId: string,
  appointment: AppointmentInput,
  patientName: string,
  patientPhone: string,
): Promise<boolean> {
  const b = await bind();
  if (!b) return false;
  try {
    const res = await fetch(
      `${CALENDAR_API}/calendars/${encodeURIComponent(b.calendarId)}/events/${eventId}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${b.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildEventBody(appointment, patientName, patientPhone)),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.error('Calendar update failed', { status: res.status, body: text.slice(0, 200) });
      return false;
    }
    logger.info(`Calendar event updated: ${eventId}`);
    return true;
  } catch (error: any) {
    logger.error('Error updating calendar event:', { message: error.message });
    return false;
  }
}

export async function deleteCalendarEvent(eventId: string): Promise<boolean> {
  const b = await bind();
  if (!b) return false;
  try {
    const res = await fetch(
      `${CALENDAR_API}/calendars/${encodeURIComponent(b.calendarId)}/events/${eventId}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${b.accessToken}` } },
    );
    // 410 Gone = already deleted
    if (res.ok || res.status === 410) {
      logger.info(`Calendar event deleted: ${eventId}`);
      return true;
    }
    const text = await res.text().catch(() => '');
    logger.error('Calendar delete failed', { status: res.status, body: text.slice(0, 200) });
    return false;
  } catch (error: any) {
    logger.error('Error deleting calendar event:', { message: error.message });
    return false;
  }
}

export async function getFreeBusySlots(date: string): Promise<{ start: Date; end: Date }[]> {
  const b = await bind();
  if (!b) return [];
  try {
    const dayStart = new Date(`${date}T00:00:00-08:00`);
    const dayEnd = new Date(`${date}T23:59:59-07:00`);
    const res = await fetch(`${CALENDAR_API}/freeBusy`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${b.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        timeZone: 'America/Los_Angeles',
        items: [{ id: b.calendarId }],
      }),
    });
    if (!res.ok) {
      logger.error('FreeBusy query failed', { status: res.status });
      return [];
    }
    const data = await res.json();
    const busy = (data.calendars?.[b.calendarId]?.busy ?? []) as Array<{ start?: string; end?: string }>;
    return busy
      .filter((s): s is { start: string; end: string } => !!s.start && !!s.end)
      .map((s) => ({ start: new Date(s.start), end: new Date(s.end) }));
  } catch (error: any) {
    logger.error('Error fetching free/busy slots:', { message: error.message });
    return [];
  }
}

/**
 * Minimal event shape returned by `getChangedEvents`. index.ts callers
 * only read these fields; keeping the type tight avoids pulling in
 * `googleapis` just for `Schema$Event`.
 */
export interface ChangedEvent {
  id?: string;
  status?: string;
  start?: { dateTime?: string };
  extendedProperties?: { private?: Record<string, string> };
}

export async function getChangedEvents(syncToken?: string): Promise<{
  events: ChangedEvent[];
  nextSyncToken: string | null;
}> {
  const b = await bind();
  if (!b) return { events: [], nextSyncToken: null };

  try {
    const all: ChangedEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | null = null;

    do {
      const params = new URLSearchParams({ singleEvents: 'true' });
      if (syncToken) {
        params.set('syncToken', syncToken);
      } else {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        params.set('timeMin', thirtyDaysAgo.toISOString());
      }
      if (pageToken) params.set('pageToken', pageToken);

      const res = await fetch(
        `${CALENDAR_API}/calendars/${encodeURIComponent(b.calendarId)}/events?${params}`,
        { headers: { Authorization: `Bearer ${b.accessToken}` } },
      );
      if (!res.ok) {
        // 410 Gone → sync token expired; retry without it for a full re-sync.
        if (res.status === 410 && syncToken) {
          logger.warn('Sync token expired, performing full sync');
          return getChangedEvents();
        }
        const text = await res.text().catch(() => '');
        logger.error('Calendar list failed', { status: res.status, body: text.slice(0, 200) });
        return { events: [], nextSyncToken: null };
      }
      const data = await res.json();
      all.push(...((data.items as ChangedEvent[]) ?? []));
      pageToken = (data.nextPageToken as string) || undefined;
      if (data.nextSyncToken) nextSyncToken = data.nextSyncToken as string;
    } while (pageToken);

    return { events: all, nextSyncToken };
  } catch (error: any) {
    logger.error('Error fetching changed events:', { message: error.message });
    return { events: [], nextSyncToken: null };
  }
}

export async function getSyncToken(): Promise<string | undefined> {
  const doc = await db.collection('system').doc('calendarSyncToken').get();
  return doc.exists ? doc.data()?.token : undefined;
}

export async function saveSyncToken(token: string): Promise<void> {
  await db.collection('system').doc('calendarSyncToken').set({
    token,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * True when the integration doc has a calendar configured. Used by the
 * scheduled sync job to skip cleanly when Google Workspace isn't set up.
 */
export async function hasCalendarConfigured(): Promise<boolean> {
  const i = await loadIntegration();
  return !!(i && i.status === 'active' && i.calendarId && i.enabledServices?.includes('calendar'));
}
