/**
 * Google Calendar Service Module
 * Handles bidirectional sync between Firestore appointments and Google Calendar.
 * Event titles include patient phone numbers for appointment-reminder SMS compatibility.
 *
 * Title format: "{firstName} {lastName} {phoneNumber}"
 * Example: "Aizle Arteta 949-284-5733"
 */

import { google, calendar_v3 } from 'googleapis';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

// Calendar API scopes — read-write for creating/updating events
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

/**
 * Get authenticated Google Calendar API client.
 * Uses a service account key with domain-wide delegation (JWT + subject)
 * to impersonate a Workspace user and get calendar write access.
 * Key is loaded from GOOGLE_SA_KEY env var (JSON string) or secret.
 */
async function getCalendarClient(): Promise<calendar_v3.Calendar> {
  const subject = process.env.GOOGLE_CALENDAR_SUBJECT;
  const saKeyJson = process.env.GOOGLE_SA_KEY;

  if (subject && saKeyJson) {
    try {
      const key = JSON.parse(saKeyJson);
      const jwtClient = new google.auth.JWT({
        email: key.client_email,
        key: key.private_key,
        scopes: SCOPES,
        subject, // impersonate this Workspace user
      });
      await jwtClient.authorize();
      return google.calendar({ version: 'v3', auth: jwtClient });
    } catch (err: any) {
      logger.error('Domain-wide delegation with key failed:', err.message);
    }
  }

  // Fallback: plain ADC (works if calendar is directly shared with SA)
  const auth = new google.auth.GoogleAuth({ scopes: SCOPES });
  const authClient = await auth.getClient();
  return google.calendar({ version: 'v3', auth: authClient as any });
}

function getCalendarId(): string {
  const id = process.env.GOOGLE_CALENDAR_ID;
  if (!id) {
    throw new Error('GOOGLE_CALENDAR_ID environment variable not set');
  }
  return id;
}

/**
 * Create a Google Calendar event from a Firestore appointment
 */
export async function createCalendarEvent(appointment: {
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
}, patientName: string, patientPhone: string): Promise<string | null> {
  try {
    const calendar = await getCalendarClient();
    const calendarId = getCalendarId();

    const startDate = appointment.appointmentDate.toDate();
    const durationMinutes = appointment.duration || 20;
    const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

    // Title format for appointment-reminder SMS compatibility
    const summary = `${patientName} ${patientPhone}`;

    // Description becomes the SMS reminder text via appointment-reminder project.
    // If admin set a custom reminderMessage, use that. Otherwise build from fields.
    let description: string;
    if (appointment.reminderMessage) {
      description = appointment.reminderMessage;
    } else {
      const parts: string[] = [];
      if (appointment.appointmentType) parts.push(appointment.appointmentType);
      if (appointment.reason) parts.push(`Reason: ${appointment.reason}`);
      if (appointment.notes) parts.push(`Notes: ${appointment.notes}`);
      description = parts.length > 0 ? parts.join('\n') : `${appointment.appointmentType || 'Appointment'}`;
    }

    const event: calendar_v3.Schema$Event = {
      summary,
      description,
      ...(appointment.address ? { location: appointment.address } : {}),
      start: {
        dateTime: startDate.toISOString(),
        timeZone: 'America/Los_Angeles',
      },
      end: {
        dateTime: endDate.toISOString(),
        timeZone: 'America/Los_Angeles',
      },
      extendedProperties: {
        private: {
          firestoreId: appointment.id,
          source: 'patient-portal',
        },
      },
    };

    const response = await calendar.events.insert({
      calendarId,
      requestBody: event,
    });

    const eventId = response.data.id;
    logger.info(`Calendar event created: ${eventId} for appointment ${appointment.id}`);
    return eventId || null;
  } catch (error: any) {
    logger.error('Error creating calendar event:', {
      message: error.message,
      code: error.code,
      status: error.status,
      errors: error.errors,
      response: error.response?.data,
    });
    return null;
  }
}

/**
 * Update an existing Google Calendar event
 */
export async function updateCalendarEvent(
  eventId: string,
  appointment: {
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
  },
  patientName: string,
  patientPhone: string
): Promise<boolean> {
  try {
    const calendar = await getCalendarClient();
    const calendarId = getCalendarId();

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
      description = parts.length > 0 ? parts.join('\n') : `${appointment.appointmentType || 'Appointment'}`;
    }

    await calendar.events.update({
      calendarId,
      eventId,
      requestBody: {
        summary,
        description,
        ...(appointment.address ? { location: appointment.address } : {}),
        start: {
          dateTime: startDate.toISOString(),
          timeZone: 'America/Los_Angeles',
        },
        end: {
          dateTime: endDate.toISOString(),
          timeZone: 'America/Los_Angeles',
        },
        extendedProperties: {
          private: {
            firestoreId: appointment.id,
            source: 'patient-portal',
          },
        },
      },
    });

    logger.info(`Calendar event updated: ${eventId}`);
    return true;
  } catch (error: any) {
    logger.error('Error updating calendar event:', {
      message: error.message,
      code: error.code,
    });
    return false;
  }
}

/**
 * Delete a Google Calendar event
 */
export async function deleteCalendarEvent(eventId: string): Promise<boolean> {
  try {
    const calendar = await getCalendarClient();
    const calendarId = getCalendarId();

    await calendar.events.delete({
      calendarId,
      eventId,
    });

    logger.info(`Calendar event deleted: ${eventId}`);
    return true;
  } catch (error: any) {
    // 410 Gone means event already deleted
    if (error.code === 410 || error.status === 410) {
      logger.info(`Calendar event already deleted: ${eventId}`);
      return true;
    }
    logger.error('Error deleting calendar event:', {
      message: error.message,
      code: error.code,
    });
    return false;
  }
}

/**
 * Get busy time ranges for a specific date using FreeBusy API
 * Returns array of { start, end } representing booked slots
 */
export async function getFreeBusySlots(date: string): Promise<{ start: Date; end: Date }[]> {
  try {
    const calendar = await getCalendarClient();
    const calendarId = getCalendarId();

    // Build day boundaries in PST
    // Use -07:00 for PDT (March-November) and -08:00 for PST
    // Simpler: query a wide window and let the FreeBusy API handle timezone
    const dayStart = new Date(`${date}T00:00:00-08:00`);
    const dayEnd = new Date(`${date}T23:59:59-07:00`);

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        timeZone: 'America/Los_Angeles',
        items: [{ id: calendarId }],
      },
    });

    const busySlots = response.data.calendars?.[calendarId]?.busy || [];

    return busySlots
      .filter((slot): slot is { start: string; end: string } => !!slot.start && !!slot.end)
      .map(slot => ({
        start: new Date(slot.start!),
        end: new Date(slot.end!),
      }));
  } catch (error: any) {
    logger.error('Error fetching free/busy slots:', {
      message: error.message,
      code: error.code,
    });
    return [];
  }
}

/**
 * Get changed events since last sync using incremental sync tokens.
 * On first call (no syncToken), fetches all events. Subsequent calls get only changes.
 */
export async function getChangedEvents(syncToken?: string): Promise<{
  events: calendar_v3.Schema$Event[];
  nextSyncToken: string | null;
}> {
  try {
    const calendar = await getCalendarClient();
    const calendarId = getCalendarId();

    const params: calendar_v3.Params$Resource$Events$List = {
      calendarId,
      singleEvents: true,
    };

    if (syncToken) {
      params.syncToken = syncToken;
    } else {
      // First sync: get events from last 30 days forward
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      params.timeMin = thirtyDaysAgo.toISOString();
    }

    const allEvents: calendar_v3.Schema$Event[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | null = null;

    do {
      if (pageToken) params.pageToken = pageToken;

      const response = await calendar.events.list(params);
      const events = response.data.items || [];
      allEvents.push(...events);

      pageToken = response.data.nextPageToken || undefined;
      if (response.data.nextSyncToken) {
        nextSyncToken = response.data.nextSyncToken;
      }
    } while (pageToken);

    return { events: allEvents, nextSyncToken };
  } catch (error: any) {
    // 410 Gone means sync token expired — need full re-sync
    if (error.code === 410 || error.status === 410) {
      logger.warn('Sync token expired, performing full sync');
      return getChangedEvents(); // Retry without sync token
    }

    logger.error('Error fetching changed events:', {
      message: error.message,
      code: error.code,
    });
    return { events: [], nextSyncToken: null };
  }
}

/**
 * Store/retrieve the sync token in Firestore
 */
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
