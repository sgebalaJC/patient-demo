/**
 * Specialist types for referral appointment requests.
 * Sorted alphabetically by label.
 */
export const SPECIALIST_TYPES: { value: string; label: string }[] = [
  { value: 'allergist', label: 'Allergist' },
  { value: 'cardiologist', label: 'Cardiologist' },
  { value: 'chiropractor', label: 'Chiropractor' },
  { value: 'dermatologist', label: 'Dermatologist' },
  { value: 'endocrinologist', label: 'Endocrinologist' },
  { value: 'gastroenterologist', label: 'Gastroenterologist' },
  { value: 'hematologist', label: 'Hematologist' },
  { value: 'infectious_disease', label: 'Infectious Disease Specialist' },
  { value: 'nephrologist', label: 'Nephrologist' },
  { value: 'neurologist', label: 'Neurologist' },
  { value: 'oncologist', label: 'Oncologist' },
  { value: 'ophthalmologist', label: 'Ophthalmologist' },
  { value: 'orthopedist', label: 'Orthopedist' },
  { value: 'otolaryngologist', label: 'Otolaryngologist (ENT)' },
  { value: 'pain_management', label: 'Pain Management' },
  { value: 'physical_therapist', label: 'Physical Therapist' },
  { value: 'plastic_surgeon', label: 'Plastic Surgeon' },
  { value: 'podiatrist', label: 'Podiatrist' },
  { value: 'psychiatrist', label: 'Psychiatrist' },
  { value: 'pulmonologist', label: 'Pulmonologist' },
  { value: 'radiologist', label: 'Radiologist' },
  { value: 'rheumatologist', label: 'Rheumatologist' },
  { value: 'urologist', label: 'Urologist' },
  { value: 'vascular_surgeon', label: 'Vascular Surgeon' },
];

/** Get display label for a specialist value */
export function getSpecialistLabel(value: string): string {
  return SPECIALIST_TYPES.find(s => s.value === value)?.label || value;
}
