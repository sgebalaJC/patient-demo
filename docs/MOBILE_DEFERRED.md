# Mobile — Deferred Items

Patient-facing mobile gaps we know about but are not tackling yet. Captured
here so they don't get re-discovered every planning pass. Revisit after the
first real customer fork goes live; none of these block the demo or the
template ship.

## 1. Documents screen parity (M)

**What:** `mobile/lib/screens/documents/documents_screen.dart` is far behind
web. Tapping a tile is a no-op; no preview modal, no delete, no grouping
by document type, no file size / uploaded-at line. Web (`DocumentsPage.tsx`)
has grouped lists, image zoom+rotate, PDF iframe, delete confirm.

**Fix sketch:**
- `mobile/lib/screens/documents/documents_screen.dart` — group by
  `documentType`, add size + uploadedAt line, wire `onTap` to preview.
- `mobile/lib/services/firestore/documents_service.dart` — add `delete()`.
- New `mobile/lib/screens/documents/document_preview_screen.dart` —
  image view (use `photo_view` or `InteractiveViewer`), PDF via
  `url_launcher` or `flutter_pdfview`.

**Why deferred:** biggest-ticket mobile gap (~half day). Won't block
a real customer who primarily manages docs from web.

---

## 2. Contact screen de-hardcode (XS)

**What:** `mobile/lib/screens/contact_screen.dart` has literal
`"123 Main St"`, `"Anytown, CA 90000"`, a Google Maps URL with
`123+Main+St+Anytown+CA`, and a hand-rolled 9–5 M–F schedule.
Every fork inherits "Anytown, CA" until it gets caught.

**Fix sketch:**
- `mobile/lib/config/branding.dart` — add `address`, `hours`,
  confirm `supportPhone` / `fax` to mirror `web/src/config/branding.ts`.
- `mobile/lib/screens/contact_screen.dart` — read from `BRANDING`, drop
  the literals; add a `tel:` launcher for the phone CTA (currently none).

**Why deferred:** bundling with the other mobile items; no single
user-reported issue.

---

## 3. New-message attachment race (S)

**What:** `mobile/lib/screens/messages/new_message_sheet.dart:120` has an
explicit self-doc TODO. Attachments upload under a path keyed by
`DateTime.now().millisecondsSinceEpoch` *before* the thread is created,
then the placeholder is never rewritten to the real threadId. Orphaned
files; URLs may live outside the thread's auth scope.

**Fix sketch:**
- `mobile/lib/services/firestore/messages_service.dart` — split thread
  creation into two steps: create empty thread → return id → upload
  attachments under `message-attachments/{threadId}/...` → patch the
  first message with the real URLs.
- `mobile/lib/services/storage_service.dart` — if needed, a helper that
  takes the final threadId.
- `mobile/lib/screens/messages/new_message_sheet.dart` — use the new
  flow.

**Why deferred:** it's a real bug with no field reports yet (demo has
~zero mobile message traffic). Worth fixing before a first paying patient
sends attachments; until then, risk is negligible.

---

## 4. Mobile dashboard loading skeletons (XS slice of a larger item)

**What:** `mobile/lib/screens/dashboard_screen.dart` shows a centered
`CircularProgressIndicator` on a blank screen while Firestore subscriptions
warm up. Web side of this is tracked with the web skeletons work; kept
here so the mobile slice doesn't get forgotten.

**Fix sketch:** skeleton cards matching the real layout (appointments
card, messages card, intake banner).

**Why deferred:** web skeletons may land first; mobile follows same
pattern once the shape is agreed.

---

## 5. `noreply@example.com` literal in mobile banner (XS)

**What:** `mobile/lib/screens/dashboard_screen.dart` `_buildEmailVerificationBanner`
renders the literal string `noreply@example.com` in copy. "This looks broken"
moment on first app open.

**Fix sketch:** replace with `BRANDING.fromEmail` (add to
`mobile/lib/config/branding.dart` if not already there; mirror the web
value).

**Why deferred:** bundle with item 2 (both are branding/config hygiene).

---

## When to revisit

Trigger any of these to drop: first paying patient on mobile, first mobile
bug report, or a customer fork where the ops team does patient work
primarily from the app. Until then, web patient surface is the higher-ROI
target.
