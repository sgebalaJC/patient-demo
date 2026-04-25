/**
 * Ambient Google Maps types. The official `@types/google.maps` package doesn't
 * cover the new `BasicPlaceAutocompleteElement` web component yet, so we hand-
 * roll the surface we use for address autocomplete in intake / specialist
 * request flows.
 *
 * TODO: replace with proper @types/google.maps once Google ships them.
 */

export {}; // make this file a module so the global block is allowed

declare global {
  namespace google.maps {
    interface PlacesLibrary {
      BasicPlaceAutocompleteElement: typeof google.maps.places.BasicPlaceAutocompleteElement;
    }

    namespace places {
      class BasicPlaceAutocompleteElement extends HTMLElement {
        value: string;
        placeholder: string;
        includedPrimaryTypes: string[];
        requestedLanguage: string;
        includedRegionCodes: string[];
        // Untyped — Google's locationBias / locationRestriction surface is wide
        // and only used as opaque values we hand back to the element.
        locationBias: unknown;
        locationRestriction: unknown;

        addEventListener(
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions,
        ): void;
      }
    }
  }
}
