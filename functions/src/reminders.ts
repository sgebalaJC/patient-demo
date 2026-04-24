/**
 * Appointment reminder cron jobs.
 *
 * - `calendarReminderScheduler` runs every 5 min, reads Calendar events
 *   starting ~24h ahead, sends an immediate SMS, and queues an 8 AM
 *   same-day reminder in `daily-reminders/{YYYY-MM-DD}`.
 * - `morningReminderScheduler` runs daily at 8 AM PST, drains the queue.
 *
 * Extracted from `index.ts` to keep the entry module shrinking. Reads SMS
 * templates from `system/sms-templates` with built-in fallbacks.
 */
import * as admin from "firebase-admin";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {logger} from "firebase-functions";
import {FUNCTIONS_BRANDING} from "./branding.js";
import {sendSms, SMS_SECRETS} from "./lib/sms-helpers.js";

function db() {
  return admin.firestore();
}

/** Extract phone from Calendar event title ("FirstName LastName 949-284-5733"). */
function extractPhoneFromTitle(title: string): string | null {
  if (!title) return null;
  const phoneRegex = /(?:\+?1[-.\s]?)?\(?([2-9][0-9]{2})\)?[-.\s]?([2-9][0-9]{2})[-.\s]?([0-9]{4})/;
  const match = title.match(phoneRegex);
  return match ? `+1${match[1]}${match[2]}${match[3]}` : null;
}

/** Format event date/time like "Aug 8, 9:00 AM" in PST. */
function formatReminderTime(dateString: string): string {
  return new Date(dateString).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Read-only Calendar client, SA with domain-wide delegation preferred. */
async function getReminderCalendarClient() {
  const subject = process.env.GOOGLE_CALENDAR_SUBJECT;
  const saKeyJson = process.env.GOOGLE_SA_KEY;

  if (subject && saKeyJson) {
    try {
      const key = JSON.parse(saKeyJson);
      const {google} = await import("googleapis");
      const jwtClient = new google.auth.JWT({
        email: key.client_email,
        key: key.private_key,
        scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
        subject,
      });
      await jwtClient.authorize();
      return google.calendar({version: "v3", auth: jwtClient});
    } catch (err: any) {
      logger.error("Reminder Calendar auth failed:", err.message);
    }
  }

  const {google} = await import("googleapis");
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  });
  const authClient = await auth.getClient();
  return google.calendar({version: "v3", auth: authClient as any});
}

async function sendReminderSMS(phoneNumber: string, body: string): Promise<void> {
  try {
    const result = await sendSms({to: phoneNumber, body, kind: "reminder", context: "appointment-reminder"});
    if (result.sent) {
      logger.info(`Reminder SMS ${result.sim ? "recorded (sim)" : "sent"}`, {phoneSuffix: phoneNumber.slice(-4)});
    }
  } catch (error: any) {
    logger.error("Error sending reminder SMS", {phoneSuffix: phoneNumber.slice(-4), message: error.message});
  }
}

const DEFAULT_SMS_TEMPLATES = {
  reminder24h: `This is an automated reminder from ${FUNCTIONS_BRANDING.shortName} of your appointment on: {content}\nScheduled for tomorrow at {time}. Don't forget!`,
  reminderMorning: `This is an automated reminder from ${FUNCTIONS_BRANDING.shortName} of your appointment on: {content}\nScheduled for today at {time}. Don't forget!`,
};

async function loadSmsTemplates(): Promise<typeof DEFAULT_SMS_TEMPLATES> {
  try {
    const doc = await db().collection("system").doc("sms-templates").get();
    if (doc.exists) {
      const data = doc.data();
      return {
        reminder24h: data?.reminder24h || DEFAULT_SMS_TEMPLATES.reminder24h,
        reminderMorning: data?.reminderMorning || DEFAULT_SMS_TEMPLATES.reminderMorning,
      };
    }
  } catch (err: any) {
    logger.warn("Failed to load SMS templates, using defaults:", err.message);
  }
  return {...DEFAULT_SMS_TEMPLATES};
}

function applyTemplate(template: string, content: string, time: string): string {
  return template.replace(/\{content\}/g, content).replace(/\{time\}/g, time);
}

export const calendarReminderScheduler = onSchedule({
  schedule: "*/5 * * * *",
  timeZone: "America/Los_Angeles",
  secrets: [...SMS_SECRETS],
}, async () => {
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) {
    logger.info("GOOGLE_CALENDAR_ID not set, skipping reminder scheduler");
    return;
  }

  try {
    const calendar = await getReminderCalendarClient();
    const templates = await loadSmsTemplates();

    const now = new Date();
    now.setSeconds(0, 0);
    const exactlyOneDayAhead = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const windowStart = new Date(exactlyOneDayAhead.getTime() - 5 * 60 * 1000);

    const response = await calendar.events.list({
      calendarId,
      timeMin: windowStart.toISOString(),
      timeMax: exactlyOneDayAhead.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = (response.data.items || []).filter((ev: any) => {
      const start = new Date(ev.start?.dateTime || ev.start?.date);
      return start >= windowStart && start <= exactlyOneDayAhead;
    });

    logger.info(`Reminder cron: ${events.length} events in 24h window`);

    for (const ev of events) {
      const phone = extractPhoneFromTitle(ev.summary || "");
      if (!phone) continue;

      const startStr = ev.start?.dateTime || ev.start?.date || "";
      const formattedTime = formatReminderTime(startStr);
      const content = ev.description || "your upcoming visit";

      await sendReminderSMS(
        phone,
        applyTemplate(templates.reminder24h, content, formattedTime),
      );

      const eventDate = new Date(startStr).toISOString().split("T")[0];
      const reminderDoc = db().collection("daily-reminders").doc(eventDate);

      await db().runTransaction(async (tx) => {
        const doc = await tx.get(reminderDoc);
        const msg = {phoneNumber: phone, content, formattedTime};
        if (doc.exists) {
          const data = doc.data();
          tx.update(reminderDoc, {messages: [...(data?.messages || []), msg]});
        } else {
          tx.set(reminderDoc, {date: eventDate, messages: [msg]});
        }
      });
    }

    logger.info("Reminder cron completed");
  } catch (error: any) {
    logger.error("Error in reminder cron:", error.message);
  }
});

export const morningReminderScheduler = onSchedule({
  schedule: "0 8 * * *",
  timeZone: "America/Los_Angeles",
  secrets: [...SMS_SECRETS],
}, async () => {
  try {
    const pstDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    logger.info(`Morning reminders for ${pstDate}`);

    const reminderDoc = await db().collection("daily-reminders").doc(pstDate).get();
    if (!reminderDoc.exists) {
      logger.info(`No reminders for ${pstDate}`);
      return;
    }

    const data = reminderDoc.data();
    const messages: Array<{phoneNumber: string; content: string; formattedTime: string}> =
      data?.messages || [];

    logger.info(`Sending ${messages.length} morning reminders`);

    const templates = await loadSmsTemplates();

    for (const msg of messages) {
      await sendReminderSMS(
        msg.phoneNumber,
        applyTemplate(templates.reminderMorning, msg.content, msg.formattedTime),
      );
    }

    await db().collection("daily-reminders").doc(pstDate).delete();
    logger.info(`Morning reminders done, cleaned up ${pstDate}`);
  } catch (error: any) {
    logger.error("Error in morning reminder:", error.message);
  }
});
