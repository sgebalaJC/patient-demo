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

## 5. ~~`noreply@example.com` literal in mobile banner (XS)~~ — DONE

Shipped in the branding-config round. `BRANDING.fromEmail` is in
`mobile/lib/config/branding.dart`; dashboard banner reads from it.

---

## 6. Release prep (S–M, per-fork)

**What:** before any real customer launches the mobile app, we need:

- Branded app icon (replace the Flutter default) — `mobile/android/app/src/main/res/mipmap-*/ic_launcher.png` and `mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset/`
- Branded splash screen — `mobile/android/app/src/main/res/drawable*/launch_background.xml` + iOS `LaunchScreen.storyboard`. Today both show the default Flutter splash.
- Android release signing config (keystore, `key.properties`, `signingConfigs` in `build.gradle.kts`)
- iOS bundle identifier + signing — `mobile/ios/Runner.xcodeproj` under the owner's Apple Developer account
- APNs keys registered in Firebase console (iOS foreground/background pushes)
- Play Store + App Store listing assets (feature graphic, screenshots, privacy policy URL)
- `package name` / `bundle id` per fork (already documented in CLAUDE.md deployment notes)

**Fix sketch:** `flutter_launcher_icons` + `flutter_native_splash` packages
automate the image generation; signing is one-time per fork using the
official Android/iOS docs.

**Why deferred:** nothing to do until the first fork commits to shipping
mobile. Demo runs in the Flutter development shell; real customers will
prep their own signing keys as part of launch.

---

## When to revisit

Trigger any of these to drop: first paying patient on mobile, first mobile
bug report, or a customer fork where the ops team does patient work
primarily from the app. Until then, web patient surface is the higher-ROI
target.
