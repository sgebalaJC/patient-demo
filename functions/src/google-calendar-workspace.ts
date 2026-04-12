/**
 * Google Calendar API helpers for the Google Workspace OAuth integration.
 * Separate from google-calendar.ts (which handles SA-based bidirectional sync).
 */

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export interface CalendarEvent {
  id: string;
  summary: string;
  description: string | null;
  location: string | null;
  start: string;
  end: string;
  attendees: string[];
  status: string;
  htmlLink: string;
}

function parseEvent(item: Record<string, unknown>): CalendarEvent {
  const start =
    (item.start as Record<string, string>)?.dateTime ||
    (item.start as Record<string, string>)?.date || "";
  const end =
    (item.end as Record<string, string>)?.dateTime ||
    (item.end as Record<string, string>)?.date || "";
  const attendees = (
    (item.attendees as Array<{email: string}>) ?? []
  ).map((a) => a.email);
  return {
    id: item.id as string,
    summary: (item.summary as string) || "(No title)",
    description: (item.description as string) || null,
    location: (item.location as string) || null,
    start,
    end,
    attendees,
    status: (item.status as string) || "confirmed",
    htmlLink: (item.htmlLink as string) || "",
  };
}

export async function listEvents(
  accessToken: string,
  timeMin: string,
  timeMax: string,
  calendarId = "primary",
  maxResults = 50,
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    maxResults: String(maxResults),
    singleEvents: "true",
    orderBy: "startTime",
  });
  const res = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    {headers: {Authorization: `Bearer ${accessToken}`}},
  );
  if (!res.ok) throw new Error(`Calendar list failed: ${res.status}`);
  const data = await res.json();
  return ((data.items as Record<string, unknown>[]) ?? []).map(parseEvent);
}

export async function getEvent(
  accessToken: string,
  eventId: string,
  calendarId = "primary",
): Promise<CalendarEvent | null> {
  const res = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    {headers: {Authorization: `Bearer ${accessToken}`}},
  );
  if (!res.ok) return null;
  return parseEvent(await res.json());
}

export async function createEvent(
  accessToken: string,
  event: {
    summary: string;
    description?: string;
    location?: string;
    start: {dateTime: string; timeZone?: string};
    end: {dateTime: string; timeZone?: string};
    attendees?: Array<{email: string}>;
  },
  calendarId = "primary",
): Promise<CalendarEvent> {
  const res = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Calendar create failed (${res.status}): ${text}`);
  }
  return parseEvent(await res.json());
}

export async function updateEvent(
  accessToken: string,
  eventId: string,
  updates: Record<string, unknown>,
  calendarId = "primary",
): Promise<CalendarEvent> {
  const res = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updates),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Calendar update failed (${res.status}): ${text}`);
  }
  return parseEvent(await res.json());
}

export async function deleteEvent(
  accessToken: string,
  eventId: string,
  calendarId = "primary",
): Promise<void> {
  const res = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    {
      method: "DELETE",
      headers: {Authorization: `Bearer ${accessToken}`},
    },
  );
  if (!res.ok && res.status !== 410) {
    throw new Error(`Calendar delete failed: ${res.status}`);
  }
}
