/// Phone number normalization — single source of truth for the mobile client.
///
/// Must match the web `normalizePhoneNumber` in web/src/lib/phone.ts and the
/// server-side `formatPhoneNumber` in functions/src/index.ts exactly so that
/// the same input produces the same stored value regardless of which client
/// writes it.
///
/// Used by every mobile path that writes `phoneNumber` to Firestore:
///  - Profile screen (direct Firestore write on save)
///  - Any future form that captures a phone number
///
/// Input examples and their outputs:
///   "14425004657"       → "+14425004657"
///   "4425004657"        → "+14425004657"
///   "(442) 500-4657"    → "+14425004657"
///   "+1 (442) 500-4657" → "+14425004657"
///   "+14425004657"      → "+14425004657"
///   ""                  → ""
String normalizePhoneNumber(String? phoneNumber) {
  if (phoneNumber == null) return '';
  final trimmed = phoneNumber.trim();
  if (trimmed.isEmpty) return '';

  // Remove all non-digit characters
  final digits = trimmed.replaceAll(RegExp(r'[^\d]'), '');

  // 10 digits → assume US, add +1
  if (digits.length == 10) {
    return '+1$digits';
  }

  // 11 digits starting with 1 → already US with country code, just add +
  if (digits.length == 11 && digits.startsWith('1')) {
    return '+$digits';
  }

  // Fallback: prepend +
  return '+$digits';
}
