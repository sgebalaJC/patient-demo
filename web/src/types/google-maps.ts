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
    /**
     * The `gmp-select` CustomEvent fired by BasicPlaceAutocompleteElement when
     * the user picks a suggestion. The detail surface is wide; we only read
     * `.place.id` and pass it to `Place.fetchFields()`.
     */
    interface GmpSelectEvent extends Event {
      place: { id?: string };
    }

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
          type: 'gmp-select',
          listener: (event: google.maps.GmpSelectEvent) => void,
          options?: boolean | AddEventListenerOptions,
        ): void;
        addEventListener(
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions,
        ): void;
      }
    }
  }
}
