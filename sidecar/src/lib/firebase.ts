/**
 * Firebase Admin SDK — initialized with the service account key on the host VM.
 * Used by admin-api routes for direct Firestore access.
 */

import { initializeApp, cert, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

const SA_KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || "/root/.openclaw/credentials/google-sa-key.json";

let _app: App | null = null;
let _db: Firestore | null = null;

export function getDb(): Firestore {
  if (!_db) {
    _app = initializeApp({
      credential: cert(SA_KEY_PATH),
    });
    _db = getFirestore(_app);
    _db.settings({ preferRest: true });
  }
  return _db;
}
