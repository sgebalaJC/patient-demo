# Mobile — Deferred Items

Patient-facing mobile gaps we know about but are not tackling yet. Captured
here so they don't get re-discovered every planning pass. Revisit after the
first real customer fork goes live; none of these block the demo or the
template ship.

## Next session — suggested start order

When we return to mobile, the highest-leverage path is:

1. **Item #4 — Mobile dashboard skeletons (XS)**: quick polish; the web
   Skeleton primitive pattern now exists (`web/src/components/ui/Skeleton.tsx`),
   mobile can mirror it.
2. **Item #6 — Release prep (S-M, per-fork)**: only when a fork commits
   to a mobile launch date.

Context notes for the next session:

- Branding config now exposes `fromEmail`, `address`, `hours`, `fax` on
  all three sides (web/mobile/functions). Item #2 is done.
- FCM tap deep-link is wired — mobile already routes notification taps
  to `MessagesScreen` + pushes `ThreadDetailScreen`. No FCM work needed.
- Phone-verify UX was softened on web; mobile equivalent is in
  `mobile/lib/screens/dashboard_screen.dart` `_buildVerifyPhoneBanner`
  and already uses the branded primary color — no port needed.

## 1. ~~Documents screen parity (M)~~ — DONE

`documents_screen.dart` now groups by `documentType` (same order as web),
shows file size + uploadedAt on each row, has a red delete icon with a
confirm dialog, and taps open a new `document_preview_screen.dart`.
Preview uses `InteractiveViewer` for images (pinch-zoom + pan + rotate)
and falls back to `url_launcher` (`LaunchMode.externalApplication`) for
PDFs and other types. Upload also now writes a proper MIME type
(`image/jpeg`, `application/pdf`, etc.) instead of the old
`application/${extension}` nonsense, so the preview can detect images
correctly. `documents_service.deleteDocument` was already present.

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

## 3. ~~New-message attachment race (S)~~ — DONE

Fixed by splitting `createThread` into `createEmptyThread` + existing
`sendMessage`. `new_message_sheet.dart` now creates the thread shell
first, uploads attachments under the real threadId (which is what
`storage.rules` requires), then sends the first message. On upload or
send failure the empty thread is best-effort deleted via
`MessagesService.deleteThread`.

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
