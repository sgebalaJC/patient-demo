# sim tests

Bun test suite for the sidecar simulation layer.

## How it works

- We stub `getDb()` via `mock.module("../../lib/firebase.js", ...)` — see `_helpers.ts` — so tests never need a live Firestore. Production sim code is untouched.
- `_helpers.ts` provides a tiny in-memory Firestore shaped just for the subset of the Admin API the sim modules actually call (collection.where/orderBy/limit/get/count/add, doc.get/set/update). `Timestamp` from `firebase-admin/firestore` works standalone — no init required.
- Each test file imports `_helpers` first (which calls `installFakeFirebase()` before sim imports), then resets the store in `beforeEach`.

Run with `bun test` from `sidecar/`.
