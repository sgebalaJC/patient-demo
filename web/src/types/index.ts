// Barrel — re-exports all domain types so existing `import { X } from '../types'`
// call sites keep working. Edit the per-domain files for new additions.

export * from './api';
export * from './user';
export * from './appointments';
export * from './messaging';
export * from './medical';
export * from './intake';
export * from './billing';

// Side-effect import: registers the Google Maps ambient declarations in the
// global namespace. Without this, intake / specialist-request pages that touch
// `google.maps.places.BasicPlaceAutocompleteElement` would not type-check.
import './google-maps';
