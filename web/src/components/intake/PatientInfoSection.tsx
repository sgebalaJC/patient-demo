import React, { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { PatientInfoForm } from '../../types';
import { FIELD_LIMITS, emailField, phoneField } from '../../lib/validation';
import { normalizePhoneNumber } from '../../lib/phone';
import { InsuranceDropdown } from './InsuranceDropdown';
import { PharmacyDropdown } from '../refills/PharmacyDropdown';
import { User } from 'lucide-react';
import { Loader } from '@googlemaps/js-api-loader';
import logger from '../../lib/logger';

const patientInfoSchema = z.object({
  fullName: z.string().min(2, 'Full name is required').max(FIELD_LIMITS.firstName.max + FIELD_LIMITS.lastName.max),
  dateOfBirth: z.string().min(1, 'Date of birth is required'),
  phoneNumber: phoneField({ required: true }),
  gender: z.enum(['male', 'female']),
  emailAddress: emailField({ required: false }),
  address: z.string().min(1, 'Address is required').max(FIELD_LIMITS.pharmacyAddress.max),

  emergencyContactName: z.string().min(1, 'Emergency contact name is required').max(FIELD_LIMITS.firstName.max + FIELD_LIMITS.lastName.max),
  emergencyContactRelationship: z.string().min(1, 'Relationship is required').max(FIELD_LIMITS.emergencyContactRelationship.max),
  emergencyContactPhone: phoneField({ required: true }),

  insuranceProvider: z.string().max(FIELD_LIMITS.insuranceProvider.max).optional().or(z.literal('')),
  policyNumber: z.string().max(FIELD_LIMITS.policyNumber.max).optional().or(z.literal('')),
  groupNumber: z.string().max(FIELD_LIMITS.groupNumber.max).optional().or(z.literal('')),

  pharmacyName: z.string().max(FIELD_LIMITS.pharmacyName.max).optional().or(z.literal('')),
  pharmacyPhone: z.string().max(FIELD_LIMITS.pharmacyPhone.max).optional().or(z.literal('')),
  pharmacyAddress: z.string().max(FIELD_LIMITS.pharmacyAddress.max).optional().or(z.literal('')),
});

type PatientInfoFormData = z.infer<typeof patientInfoSchema>;

interface PatientInfoSectionProps {
  onComplete: (data: PatientInfoForm) => void;
  initialData?: PatientInfoForm;
}

/** Set up a Google Places BasicPlaceAutocompleteElement on an input ref. */
function useGooglePlacesAutocomplete(
  inputRef: React.RefObject<HTMLInputElement | null>,
  onSelect: (address: string) => void,
) {
  const autocompleteRef = useRef<google.maps.places.BasicPlaceAutocompleteElement | null>(null);

  useEffect(() => {
    if (!inputRef.current) return;

    const loader = new Loader({
      apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
      libraries: ['places'],
      version: 'weekly',
    });

    let cleanedUp = false;

    const init = async () => {
      try {
        await loader.load();
        if (cleanedUp || !inputRef.current) return;

        const { BasicPlaceAutocompleteElement } = (await google.maps.importLibrary(
          'places',
        )) as google.maps.PlacesLibrary;

        const el = new BasicPlaceAutocompleteElement();
        el.includedPrimaryTypes = ['street_address', 'route', 'premise'];
        el.requestedLanguage = 'en';

        const orig = inputRef.current;
        const cs = window.getComputedStyle(orig);
        if (orig.placeholder) el.setAttribute('placeholder', orig.placeholder);

        const isDark = document.documentElement.classList.contains('dark');

        const style = document.createElement('style');
        style.textContent = `
          gmp-basic-place-autocomplete {
            width: 100% !important;
            color-scheme: ${isDark ? 'dark' : 'light'} !important;
            height: ${cs.height} !important; min-height: ${cs.minHeight} !important;
            padding: 0px !important; margin: ${cs.margin} !important;
            border: ${cs.border} !important; border-radius: ${cs.borderRadius} !important;
            font-family: ${cs.fontFamily} !important; font-size: ${cs.fontSize} !important;
            background-color: ${cs.backgroundColor} !important;
            color: ${cs.color} !important;
            box-sizing: ${cs.boxSizing} !important; outline: none !important;
          }
        `;
        document.head.appendChild(style);

        // Apply color-scheme to the element directly so the overlay inherits it
        el.style.colorScheme = isDark ? 'dark' : 'light';

        orig.style.display = 'none';
        orig.parentNode?.insertBefore(el, orig.nextSibling);
        autocompleteRef.current = el;

        el.addEventListener('click', (e: Event) => {
          if (e.composedPath().some((n) => (n as HTMLElement).tagName === 'A')) e.preventDefault();
        }, true);

        el.addEventListener('gmp-select', async (event) => {
          const place = event.place;
          if (!place.id) return;
          try {
            const { Place } = (await google.maps.importLibrary('places')) as google.maps.PlacesLibrary;
            const inst = new Place({ id: place.id, requestedLanguage: 'en' });
            await inst.fetchFields({ fields: ['formattedAddress'] });
            if (inst.formattedAddress) onSelect(inst.formattedAddress);
          } catch (err) {
            logger.error('Error fetching place details:', err);
          }
        });
      } catch (err) {
        logger.error('Error initializing Google Places:', err);
      }
    };

    init();

    return () => {
      cleanedUp = true;
      if (autocompleteRef.current) {
        autocompleteRef.current.remove();
        autocompleteRef.current = null;
      }
      if (inputRef.current) inputRef.current.style.display = '';
    };
  }, []);
}

export const PatientInfoSection: React.FC<PatientInfoSectionProps> = ({
  onComplete,
  initialData,
}) => {
  const [loading, setLoading] = useState(false);
  const [selectedPatientAddress, setSelectedPatientAddress] = useState(initialData?.address || '');
  const [selectedPharmacyAddress, setSelectedPharmacyAddress] = useState(initialData?.pharmacyAddress || '');

  const patientAddressRef = useRef<HTMLInputElement | null>(null);
  const pharmacyAddressRef = useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<PatientInfoFormData>({
    resolver: zodResolver(patientInfoSchema),
    defaultValues: initialData ? {
      fullName: initialData.fullName || '',
      dateOfBirth: initialData.dateOfBirth || '',
      phoneNumber: initialData.phoneNumber || '',
      gender: initialData.gender || 'male',
      emailAddress: initialData.emailAddress || '',
      address: initialData.address || '',
      emergencyContactName: initialData.emergencyContactName || '',
      emergencyContactRelationship: initialData.emergencyContactRelationship || '',
      emergencyContactPhone: initialData.emergencyContactPhone || '',
      insuranceProvider: initialData.insuranceProvider || '',
      policyNumber: initialData.policyNumber || '',
      groupNumber: initialData.groupNumber || '',
      pharmacyName: initialData.pharmacyName || '',
      pharmacyPhone: initialData.pharmacyPhone || '',
      pharmacyAddress: initialData.pharmacyAddress || '',
    } : {
      fullName: '',
      dateOfBirth: '',
      phoneNumber: '',
      gender: 'male',
      emailAddress: '',
      address: '',
      emergencyContactName: '',
      emergencyContactRelationship: '',
      emergencyContactPhone: '',
      insuranceProvider: '',
      policyNumber: '',
      groupNumber: '',
      pharmacyName: '',
      pharmacyPhone: '',
      pharmacyAddress: '',
    },
  });

  // Google Places autocomplete for patient address
  useGooglePlacesAutocomplete(patientAddressRef, (addr) => {
    setSelectedPatientAddress(addr);
    setValue('address', addr, { shouldValidate: true });
  });

  // Google Places autocomplete for pharmacy address
  useGooglePlacesAutocomplete(pharmacyAddressRef, (addr) => {
    setSelectedPharmacyAddress(addr);
    setValue('pharmacyAddress', addr, { shouldValidate: true });
  });

  const onSubmit = async (data: PatientInfoFormData) => {
    setLoading(true);
    try {
      // completedAt is stamped by intakeFormOperations.updateIntakeFormSection
      // (serverTimestamp). Do not set it here.
      const formData = {
        ...data,
        phoneNumber: normalizePhoneNumber(data.phoneNumber),
        emergencyContactPhone: normalizePhoneNumber(data.emergencyContactPhone),
        pharmacyPhone: data.pharmacyPhone ? normalizePhoneNumber(data.pharmacyPhone) : data.pharmacyPhone,
        address: selectedPatientAddress || data.address,
        pharmacyAddress: selectedPharmacyAddress || data.pharmacyAddress,
      } as PatientInfoForm;
      onComplete(formData);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-4 sm:p-8">
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center space-y-3 sm:space-y-0 sm:space-x-3 mb-4">
          <div className="bg-primary-100 p-2 sm:p-3 rounded-lg flex-shrink-0">
            <User className="h-6 w-6 sm:h-8 sm:w-8 text-primary-600" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold text-secondary-900 truncate">Patient Information</h2>
            <p className="text-secondary-600 text-sm sm:text-base">
              Please provide your personal and contact information
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        {/* Patient Information */}
        <div>
          <h3 className="text-lg font-semibold text-secondary-900 mb-4">Personal Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              {...register('fullName')}
              label="Full Name *"
              placeholder="First and last name"
              error={errors.fullName?.message}
            />
            <div>
              <label className="block text-sm font-medium text-secondary-700 mb-2">Date of Birth *</label>
              <input
                {...register('dateOfBirth')}
                type="date"
                className="input w-full"
              />
              {errors.dateOfBirth && (
                <p className="mt-1 text-sm text-red-600">{errors.dateOfBirth.message}</p>
              )}
            </div>
            <Input
              {...register('phoneNumber')}
              label="Phone Number *"
              type="tel"
              placeholder="(555) 555-5555"
              error={errors.phoneNumber?.message}
            />
            <div>
              <label className="block text-sm font-medium text-secondary-700 mb-2">Gender *</label>
              <div className="flex items-center space-x-6 mt-1">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    {...register('gender')}
                    type="radio"
                    value="male"
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-secondary-300"
                  />
                  <span className="text-sm text-secondary-700">Male</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    {...register('gender')}
                    type="radio"
                    value="female"
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-secondary-300"
                  />
                  <span className="text-sm text-secondary-700">Female</span>
                </label>
              </div>
              {errors.gender && (
                <p className="mt-1 text-sm text-red-600">{errors.gender.message}</p>
              )}
            </div>
            <Input
              {...register('emailAddress')}
              label="Email Address *"
              type="email"
              placeholder="you@example.com"
              error={errors.emailAddress?.message}
            />
            {/* Patient Address with Google Places autocomplete */}
            <div>
              <Input
                {...register('address')}
                label="Address *"
                placeholder="Start typing address..."
                error={errors.address?.message}
                ref={(e) => {
                  register('address').ref(e);
                  patientAddressRef.current = e;
                }}
              />
              {selectedPatientAddress && (
                <div className="mt-2 p-2 bg-secondary-50 border border-secondary-200 rounded-md">
                  <p className="text-xs text-secondary-700">
                    <span className="font-medium">Selected:</span> {selectedPatientAddress}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPatientAddress('');
                      setValue('address', '', { shouldValidate: true });
                    }}
                    className="mt-1 text-xs text-red-600 hover:text-red-800 underline"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Emergency Contact */}
        <div>
          <h3 className="text-lg font-semibold text-secondary-900 mb-4">Emergency Contact</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              {...register('emergencyContactName')}
              label="Name *"
              error={errors.emergencyContactName?.message}
            />
            <Input
              {...register('emergencyContactRelationship')}
              label="Relationship *"
              error={errors.emergencyContactRelationship?.message}
            />
            <Input
              {...register('emergencyContactPhone')}
              label="Phone Number *"
              type="tel"
              error={errors.emergencyContactPhone?.message}
            />
          </div>
        </div>

        {/* Insurance Information */}
        <div>
          <h3 className="text-lg font-semibold text-secondary-900 mb-4">Insurance Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <InsuranceDropdown
              value={watch('insuranceProvider') || ''}
              onChange={(value) => setValue('insuranceProvider', value, { shouldValidate: true })}
              error={errors.insuranceProvider?.message}
            />
            <Input
              {...register('policyNumber')}
              label="Policy Number"
            />
            <Input
              {...register('groupNumber')}
              label="Group Number"
            />
          </div>
        </div>

        {/* Preferred Pharmacy */}
        <div>
          <h3 className="text-lg font-semibold text-secondary-900 mb-4">Preferred Pharmacy</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PharmacyDropdown
              value={watch('pharmacyName') || ''}
              onChange={(value) => setValue('pharmacyName', value, { shouldValidate: true })}
              label="Pharmacy Name"
              placeholder="Select a pharmacy"
            />
            <Input
              {...register('pharmacyPhone')}
              label="Phone Number"
              type="tel"
            />
          </div>
          {/* Pharmacy Address with Google Places autocomplete */}
          <div className="mt-4">
            <Input
              {...register('pharmacyAddress')}
              label="Pharmacy Address"
              placeholder="Start typing address..."
              ref={(e) => {
                register('pharmacyAddress').ref(e);
                pharmacyAddressRef.current = e;
              }}
            />
            {selectedPharmacyAddress && (
              <div className="mt-2 p-2 bg-secondary-50 border border-secondary-200 rounded-md">
                <p className="text-xs text-secondary-700">
                  <span className="font-medium">Selected:</span> {selectedPharmacyAddress}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPharmacyAddress('');
                    setValue('pharmacyAddress', '', { shouldValidate: true });
                  }}
                  className="mt-1 text-xs text-red-600 hover:text-red-800 underline"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-center pt-6 border-t border-secondary-200">
          <Button type="submit" loading={loading} className="px-8">
            Complete Patient Information
          </Button>
        </div>
      </form>
    </Card>
  );
};
