/// Phone normalization — US-only. Canonical stored format is 10 digits
/// (no `+1`, no punctuation): `"4425004657"`. Mirrors
/// `web/src/lib/phone.ts` and `functions/src/lib/phone.ts` — all three
/// implementations MUST produce identical output for identical input.
///
/// External APIs that require E.164 (Twilio, Firebase Auth) wrap with
/// `toE164(...)` at the boundary.
///
/// Input examples and their outputs:
///   "4425004657"        → "4425004657"
///   "(442) 500-4657"    → "4425004657"
///   "+1 (442) 500-4657" → "4425004657"
///   "14425004657"       → "4425004657"
///   ""                  → ""  (empty stays empty)
///   "+33123456789"      → throws InvalidPhoneException (non-US)
library;

class InvalidPhoneException implements Exception {
  final String input;
  InvalidPhoneException(this.input);
  @override
  String toString() =>
      'InvalidPhoneException: Invalid US phone number: "$input". Expected 10 digits.';
}

/// Strip to digits and validate as a US 10-digit number. Empty input
/// returns empty string. Anything that doesn't reduce to exactly 10 digits
/// (or 11 starting with 1) throws `InvalidPhoneException` — callers must
/// catch and surface a field error to the user.
String normalizePhoneNumber(String? phoneNumber) {
  if (phoneNumber == null) return '';
  final trimmed = phoneNumber.trim();
  if (trimmed.isEmpty) return '';

  final digits = trimmed.replaceAll(RegExp(r'[^\d]'), '');
  if (digits.length == 10) return digits;
  if (digits.length == 11 && digits.startsWith('1')) {
    return digits.substring(1);
  }
  throw InvalidPhoneException(trimmed);
}

/// Format a canonical 10-digit phone for display.
///
/// Input:  "4425004657"
/// Output: "(442) 500-4657"
///
/// Also accepts `+1XXXXXXXXXX` / `1XXXXXXXXXX` so values read straight from
/// Twilio webhook payloads render without a second normalize step.
/// Unrecognized shapes return as-is.
String formatPhoneDisplay(String? phoneNumber) {
  if (phoneNumber == null || phoneNumber.isEmpty) return '';

  final digits = phoneNumber.replaceAll(RegExp(r'[^\d]'), '');

  if (digits.length == 10) {
    return '(${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6)}';
  }
  if (digits.length == 11 && digits.startsWith('1')) {
    final local = digits.substring(1);
    return '(${local.substring(0, 3)}) ${local.substring(3, 6)}-${local.substring(6)}';
  }
  return phoneNumber;
}

/// Convert a canonical 10-digit phone to E.164 (`+1XXXXXXXXXX`) for
/// external APIs (Twilio, Firebase Auth). Throws on invalid input.
String toE164(String phone10) {
  final digits = phone10.replaceAll(RegExp(r'[^\d]'), '');
  if (digits.length == 10) return '+1$digits';
  if (digits.length == 11 && digits.startsWith('1')) return '+$digits';
  throw InvalidPhoneException(phone10);
}
