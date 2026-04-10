/// Google Places API key for HTTP REST calls (autocomplete, place details).
/// Restricted to Places API only (no app restriction — required for HTTP calls from device).
/// TEMPLATE: Replace with your own Places API key before shipping.
const String googleMapsApiKey = 'REPLACE_WITH_GOOGLE_PLACES_API_KEY';

/// Default appointment duration in minutes (matches web BRANDING.defaultAppointmentDuration)
const int defaultAppointmentDuration = 20;

/// Field length limits matching web/src/lib/validation.ts FIELD_LIMITS
class FieldLimits {
  static const int firstNameMin = 2;
  static const int firstNameMax = 100;
  static const int lastNameMin = 2;
  static const int lastNameMax = 100;
  static const int emailMax = 254;
  static const int phoneNumberMax = 20;
  static const int passwordMin = 8;
  static const int passwordMax = 128;
  static const int messageSubjectMin = 5;
  static const int messageSubjectMax = 200;
  static const int messageContentMin = 10;
  static const int messageContentMax = 5000;
  static const int medicationNameMin = 2;
  static const int medicationNameMax = 200;
  static const int dosageMax = 200;
  static const int quantityMax = 100;
  static const int pharmacyNameMax = 200;
  static const int specialistReasonMin = 10;
  static const int specialistReasonMax = 500;
  static const int notesMax = 2000;
  static const int descriptionMax = 500;
}
