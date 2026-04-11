#!/usr/bin/env npx ts-node
/**
 * One-shot migration for installs that pre-date the App Settings system.
 *
 * Writes `system/settings` with sensible defaults:
 *   - registrationEnabled: false   (locked down by default)
 *   - paginationSize: 25
 *   - bootstrapped: <auto>         (true if any admin already exists)
 *
 * Run once after deploying the App Settings changes:
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=path/to/sa-key.json \
 *     npx ts-node scripts/init-app-settings.ts [--project showmd-patient]
 *
 * Idempotent — safe to re-run; never overwrites a pre-existing
 * `bootstrapped: true` flag.
 */
import * as admin from 'firebase-admin';

const projectArgIdx = process.argv.indexOf('--project');
const projectId = projectArgIdx >= 0 ? process.argv[projectArgIdx + 1] : undefined;

admin.initializeApp(projectId ? { projectId } : undefined);
const db = admin.firestore();

async function main() {
  const settingsRef = db.collection('system').doc('settings');
  const existing = await settingsRef.get();
  const existingData = existing.data() || {};

  // Decide bootstrapped flag — true if any active admin exists OR already set
  let bootstrapped = existingData.bootstrapped === true;
  if (!bootstrapped) {
    const adminQuery = await db
      .collection('users')
      .where('role', '==', 'admin')
      .where('isActive', '==', true)
      .limit(1)
      .get();
    bootstrapped = !adminQuery.empty;
  }

  const next = {
    registrationEnabled:
      typeof existingData.registrationEnabled === 'boolean'
        ? existingData.registrationEnabled
        : false,
    paginationSize:
      typeof existingData.paginationSize === 'number' && existingData.paginationSize > 0
        ? existingData.paginationSize
        : 25,
    bootstrapped,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await settingsRef.set(next, { merge: true });

  console.log('system/settings initialized:');
  console.log('  registrationEnabled:', next.registrationEnabled);
  console.log('  paginationSize:    ', next.paginationSize);
  console.log('  bootstrapped:      ', next.bootstrapped);
  if (bootstrapped && !existingData.bootstrapped) {
    console.log('  (bootstrapped flag set automatically — found existing admin)');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
