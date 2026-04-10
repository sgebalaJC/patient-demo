/// Specialist types for referral appointment requests.
/// Sorted alphabetically by label. Mirrors web/src/config/specialists.ts.
const List<MapEntry<String, String>> specialistTypes = [
  MapEntry('allergist', 'Allergist'),
  MapEntry('cardiologist', 'Cardiologist'),
  MapEntry('chiropractor', 'Chiropractor'),
  MapEntry('dermatologist', 'Dermatologist'),
  MapEntry('endocrinologist', 'Endocrinologist'),
  MapEntry('gastroenterologist', 'Gastroenterologist'),
  MapEntry('hematologist', 'Hematologist'),
  MapEntry('infectious_disease', 'Infectious Disease Specialist'),
  MapEntry('nephrologist', 'Nephrologist'),
  MapEntry('neurologist', 'Neurologist'),
  MapEntry('oncologist', 'Oncologist'),
  MapEntry('ophthalmologist', 'Ophthalmologist'),
  MapEntry('orthopedist', 'Orthopedist'),
  MapEntry('otolaryngologist', 'Otolaryngologist (ENT)'),
  MapEntry('pain_management', 'Pain Management'),
  MapEntry('physical_therapist', 'Physical Therapist'),
  MapEntry('plastic_surgeon', 'Plastic Surgeon'),
  MapEntry('podiatrist', 'Podiatrist'),
  MapEntry('psychiatrist', 'Psychiatrist'),
  MapEntry('pulmonologist', 'Pulmonologist'),
  MapEntry('radiologist', 'Radiologist'),
  MapEntry('rheumatologist', 'Rheumatologist'),
  MapEntry('urologist', 'Urologist'),
  MapEntry('vascular_surgeon', 'Vascular Surgeon'),
];

/// Get display label for a specialist value.
String getSpecialistLabel(String value) {
  for (final entry in specialistTypes) {
    if (entry.key == value) return entry.value;
  }
  return value;
}
