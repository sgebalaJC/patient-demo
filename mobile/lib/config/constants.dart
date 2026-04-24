/// Google Places API key for HTTP REST calls (autocomplete, place details).
/// Restricted to Places API only (no app restriction — required for HTTP calls from device).
/// TEMPLATE: Replace with your own Places API key before shipping.
const String googleMapsApiKey = 'REPLACE_WITH_GOOGLE_PLACES_API_KEY';

/// Field length limits matching web/src/lib/validation.ts FIELD_LIMITS.
/// Keep in sync: when a field is added to the web FIELD_LIMITS, mirror it
/// here so the mobile form enforces the same ceiling. CI has no cross-
/// language check for drift — reviewer must eyeball both sides.
class FieldLimits {
  // Identity
  static const int firstNameMin = 2;
  static const int firstNameMax = 100;
  static const int lastNameMin = 2;
  static const int lastNameMax = 100;
  static const int emailMax = 254;
  static const int phoneNumberMax = 20;
  static const int passwordMin = 8;
  static const int passwordMax = 128;

  // Messages
  static const int messageSubjectMin = 5;
  static const int messageSubjectMax = 200;
  static const int messageContentMin = 10;
  static const int messageContentMax = 5000;

  // Todos
  static const int todoTitleMin = 1;
  static const int todoTitleMax = 100;
  static const int todoDescriptionMax = 1000;
  static const int todoCategoryMax = 100;

  // Prescriptions
  static const int medicationNameMin = 2;
  static const int medicationNameMax = 200;
  static const int dosageMax = 200;
  static const int quantityMax = 100;
  static const int pharmacyNameMax = 200;
  static const int pharmacyPhoneMax = 20;
  static const int pharmacyAddressMax = 500;

  // Specialist requests
  static const int specialistReasonMin = 10;
  static const int specialistReasonMax = 500;

  // General
  static const int notesMax = 2000;
  static const int descriptionMax = 500;
  static const int signatureMax = 200;
  static const int detailsFieldMax = 500;
  static const int roleMax = 20;

  // Prior Authorization
  static const int priorAuthMemberNumberMax = 64;
  static const int priorAuthGroupNumberMax = 64;
  static const int priorAuthReferenceNumberMax = 64;
  static const int priorAuthAuthNumberMax = 64;
  static const int priorAuthDenialReasonMax = 1000;
  static const int priorAuthNotesMax = 2000;
  static const int priorAuthEvidenceMax = 2000;
  static const int priorAuthCptCodeMin = 5;
  static const int priorAuthCptCodeMax = 5;
  static const int priorAuthIcd10CodeMax = 10;
}
