/**
 * Shared OTP code issue + verify for phone-based flows. Two callers today:
 *  - `sendPhoneVerificationCode` / `verifyPhoneCode`  (authenticated profile update)
 *  - `sendPhoneLoginCode` / `verifyPhoneLogin`        (unauthenticated OTP login)
 *
 * Both used to inline the 6-digit randomInt + sha256 + expiry + attempts
 * pattern with subtly different TTLs. Keeping it in one module prevents
 * drift.
 */

import * as admin from "firebase-admin";
import * as crypto from "crypto";

export const MAX_ATTEMPTS = 5;

export interface IssueCodeOptions {
  /** Firestore collection path to write the verification doc into. */
  collection: string;
  /** Doc id — typically `uid` for auth'd flow, `phoneE164Stripped` for login. */
  docId: string;
  /** Normalized 10-digit phone to embed in the doc for auditing. */
  phoneNumber: string;
  /** Expiry in minutes. */
  ttlMinutes: number;
}

export interface IssueCodeResult {
  /** Plain 6-digit code to deliver out-of-band. Never log this. */
  code: string;
}

/**
 * Generate a 6-digit code, hash it with SHA-256, write the hash + phone +
 * expiry to Firestore, and return the plain code for the caller to send
 * over SMS. The hash is stored; the plain code never touches Firestore.
 */
export async function issueCode(opts: IssueCodeOptions): Promise<IssueCodeResult> {
  const code = crypto.randomInt(100000, 999999).toString();
  const codeHash = crypto.createHash("sha256").update(code).digest("hex");
  const expiresAt = new Date(Date.now() + opts.ttlMinutes * 60 * 1000);
  await admin
    .firestore()
    .collection(opts.collection)
    .doc(opts.docId)
    .set({
      phoneNumber: opts.phoneNumber,
      codeHash,
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      attempts: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  return {code};
}

export type CheckCodeOutcome =
  | {ok: true; phoneNumber: string}
  | {ok: false; error: string; expired?: boolean; tooManyAttempts?: boolean};

export interface CheckCodeOptions {
  collection: string;
  docId: string;
  code: string;
}

/**
 * Read the verification doc, enforce expiry + attempt cap, compare the
 * hashed input, and delete the doc on success / terminal failure.
 *
 * - On success: `{ok: true, phoneNumber}` with the phone stored alongside
 *   the code, and deletes the doc.
 * - On expired/too-many-attempts: `{ok: false, ...}` and deletes the doc.
 * - On wrong code: `{ok: false}`, attempts counter incremented, doc kept.
 */
export async function checkCode(opts: CheckCodeOptions): Promise<CheckCodeOutcome> {
  const ref = admin.firestore().collection(opts.collection).doc(opts.docId);
  const snap = await ref.get();
  if (!snap.exists) {
    return {ok: false, error: "No verification pending. Please request a new code."};
  }
  const data = snap.data()!;

  if (data.expiresAt.toDate() < new Date()) {
    await ref.delete();
    return {ok: false, error: "Code expired. Please request a new one.", expired: true};
  }

  if ((data.attempts ?? 0) >= MAX_ATTEMPTS) {
    await ref.delete();
    return {
      ok: false,
      error: "Too many attempts. Please request a new code.",
      tooManyAttempts: true,
    };
  }

  await ref.update({attempts: (data.attempts ?? 0) + 1});

  const inputHash = crypto.createHash("sha256").update(opts.code).digest("hex");
  if (inputHash !== data.codeHash) {
    return {ok: false, error: "Incorrect code. Please try again."};
  }

  await ref.delete();
  return {ok: true, phoneNumber: data.phoneNumber as string};
}
