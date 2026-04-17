/**
 * Per-session message generators — NOT seeded, generated fresh on each call so
 * the demo patient's inbox feels alive. If realism matters more than speed,
 * swap the stub for a cheap LLM call.
 */
import {SimContext} from "../index.js";

interface DemoMessage {
  id: string;
  from: string;
  subject: string;
  body: string;
  sentAt: string;
}

const SENDERS = ["Dr. Patel", "Nurse Kim", "Front Desk", "Billing", "Pharmacy"];
const SUBJECTS = [
  "Your lab results are ready",
  "Appointment reminder",
  "Prescription refill approved",
  "Insurance update needed",
  "Follow-up visit requested",
];

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

export async function inbox(
  _ctx: SimContext,
  params: {limit?: number},
): Promise<{messages: DemoMessage[]}> {
  const n = Math.min(Math.max(params.limit ?? 4, 1), 10);
  const now = Date.now();
  const messages: DemoMessage[] = Array.from({length: n}, (_, i) => {
    const seed = now + i * 997;
    return {
      id: `sim-msg-${now}-${i}`,
      from: pick(SENDERS, seed),
      subject: pick(SUBJECTS, seed + 1),
      body: `This is a simulated message for the demo environment. (#${i + 1})`,
      sentAt: new Date(now - i * 3600_000).toISOString(),
    };
  });
  return {messages};
}
