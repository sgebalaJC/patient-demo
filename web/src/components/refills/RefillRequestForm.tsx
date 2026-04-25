import React, { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Pill } from 'lucide-react';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Input } from '../ui/Input';
import { PrescriptionRefillRequest } from '../../types';
import { prescriptionRefillOperations, notificationOperations } from '../../lib/firestore';
import { useAuth } from '../../hooks/useAuth';
import { FIELD_LIMITS } from '../../lib/validation';
import { errorMessage } from '../../lib/errors';
import logger from "../../lib/logger";
import { Loader } from "@googlemaps/js-api-loader";
import { PharmacyDropdown } from './PharmacyDropdown';
import { Modal } from '../ui/Modal';

const refillRequestSchema = z.object({
  medicationName: z.string().min(1, 'Medication name is required').min(FIELD_LIMITS.medicationName.min, `Medication name must be at least ${FIELD_LIMITS.medicationName.min} characters`).max(FIELD_LIMITS.medicationName.max, `Medication name must be less than ${FIELD_LIMITS.medicationName.max} characters`),
  dosage: z.string().min(1, 'Dosage is required').max(FIELD_LIMITS.dosage.max, `Dosage must be less than ${FIELD_LIMITS.dosage.max} characters`),
  quantity: z.string().min(1, 'Quantity is required').max(FIELD_LIMITS.quantity.max, `Quantity must be less than ${FIELD_LIMITS.quantity.max} characters`),
  pharmacyName: z.string().min(1, 'Pharmacy name is required').max(FIELD_LIMITS.pharmacyName.max, `Pharmacy name must be less than ${FIELD_LIMITS.pharmacyName.max} characters`),
  pharmacyPhone: z.string().max(FIELD_LIMITS.pharmacyPhone.max, 'Phone number is too long').optional(),
  pharmacyAddress: z.string().max(FIELD_LIMITS.pharmacyAddress.max, 'Address is too long').optional(),
  urgency: z.enum(['routine', 'urgent', 'emergency']),
  notes: z.string().max(FIELD_LIMITS.notes.max, `Notes must be less than ${FIELD_LIMITS.notes.max} characters`).optional(),
});

type RefillRequestFormData = z.infer<typeof refillRequestSchema>;

interface RefillRequestFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  patientId: string;
  editingRefill?: PrescriptionRefillRequest;
}

export const RefillRequestForm: React.FC<RefillRequestFormProps> = ({
  isOpen,
  onClose,
  onSuccess,
  patientId,
  editingRefill,
}) => {
  const { userProfile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [selectedAddress, setSelectedAddress] = useState('');
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const basicAutocompleteRef = useRef<google.maps.places.BasicPlaceAutocompleteElement | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    watch,
  } = useForm<RefillRequestFormData>({
    resolver: zodResolver(refillRequestSchema),
    defaultValues: {
      urgency: 'routine',
    },
  });

  // Load Google Maps script dynamically
  useEffect(() => {
    if (!addressInputRef.current) return;

    const loader = new Loader({
      apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
      libraries: ["places"],
      version: "weekly"
    });

    const initializeBasicAutocomplete = async () => {
      try {
        await loader.load();

        const { BasicPlaceAutocompleteElement } = await google.maps.importLibrary("places") as google.maps.PlacesLibrary;

        if (!addressInputRef.current) return;

        const basicAutocompleteElement = new BasicPlaceAutocompleteElement();
        basicAutocompleteElement.includedPrimaryTypes = ['street_address', 'route', 'premise'];
        basicAutocompleteElement.requestedLanguage = 'en';

        // Get ALL computed styles from your original input
        const originalInput = addressInputRef.current;
        const computedStyles = window.getComputedStyle(originalInput);

        // Copy the placeholder
        if (originalInput.placeholder) {
          basicAutocompleteElement.setAttribute('placeholder', originalInput.placeholder);
        }

        // Force light theme and copy exact styling
        const styleSheet = document.createElement('style');
        styleSheet.textContent = `
          gmp-basic-place-autocomplete {
            width: 100% !important;
            color-scheme: light !important;
            width: ${computedStyles.width} !important;
            height: ${computedStyles.height} !important;
            min-height: ${computedStyles.minHeight} !important;
            padding: 0px !important;
            margin: ${computedStyles.margin} !important;
            border: ${computedStyles.border} !important;
            border-radius: ${computedStyles.borderRadius} !important;
            font-family: ${computedStyles.fontFamily} !important;
            font-size: ${computedStyles.fontSize} !important;
            font-weight: ${computedStyles.fontWeight} !important;
            line-height: ${computedStyles.lineHeight} !important;
            color: ${computedStyles.color} !important;
            background-color: ${computedStyles.backgroundColor} !important;
            background-image: ${computedStyles.backgroundImage} !important;
            background-position: ${computedStyles.backgroundPosition} !important;
            background-repeat: ${computedStyles.backgroundRepeat} !important;
            background-size: ${computedStyles.backgroundSize} !important;
            box-shadow: ${computedStyles.boxShadow} !important;
            text-align: ${computedStyles.textAlign} !important;
            text-decoration: ${computedStyles.textDecoration} !important;
            text-transform: ${computedStyles.textTransform} !important;
            letter-spacing: ${computedStyles.letterSpacing} !important;
            word-spacing: ${computedStyles.wordSpacing} !important;
            box-sizing: ${computedStyles.boxSizing} !important;
            outline: none !important;
          }
        `;
        document.head.appendChild(styleSheet);

        // Hide the React input instead of replacing it (replaceChild crashes React)
        addressInputRef.current.style.display = 'none';
        addressInputRef.current.parentNode?.insertBefore(basicAutocompleteElement, addressInputRef.current.nextSibling);

        basicAutocompleteRef.current = basicAutocompleteElement;

        // Prevent suggestions from opening a new tab (they render as <a> tags inside shadow DOM)
        basicAutocompleteElement.addEventListener('click', (e: Event) => {
          const path = e.composedPath();
          if (path.some((el) => (el as HTMLElement).tagName === 'A')) {
            e.preventDefault();
          }
        }, true);

        // Handle place selection
        basicAutocompleteElement.addEventListener('gmp-select', async (event: any) => {
          const place = event.place;

          if (!place.id) return;

          try {
            const { Place } = await google.maps.importLibrary("places") as google.maps.PlacesLibrary;

            const placeInstance = new Place({
              id: place.id,
              requestedLanguage: 'en'
            });

            await placeInstance.fetchFields({
              fields: ['formattedAddress']
            });

            if (placeInstance.formattedAddress) {
              // Store the selected address in state
              setSelectedAddress(placeInstance.formattedAddress);
              // Also update the form value for validation/submission
              setValue("pharmacyAddress", placeInstance.formattedAddress, { shouldValidate: true });
            }
          } catch (error) {
            logger.error('Error fetching place details:', error);
          }
        });

      } catch (error) {
        logger.error('Error initializing Google Places:', error);
      }
    };

    initializeBasicAutocomplete();

    return () => {
      if (basicAutocompleteRef.current) {
        basicAutocompleteRef.current.remove();
        basicAutocompleteRef.current = null;
      }
      // Restore the hidden React input
      if (addressInputRef.current) {
        addressInputRef.current.style.display = '';
      }
    };
  }, [setValue, isOpen]);

  // Reset form with editing data when editingRefill changes
  useEffect(() => {
    if (editingRefill) {
      reset({
        medicationName: editingRefill.medicationName,
        dosage: editingRefill.dosage,
        quantity: editingRefill.quantity,
        pharmacyName: editingRefill.pharmacyName,
        pharmacyPhone: editingRefill.pharmacyPhone || '',
        pharmacyAddress: editingRefill.pharmacyAddress || '',
        urgency: editingRefill.urgency,
        notes: editingRefill.notes || '',
      });
      // Set selected address when editing
      setSelectedAddress(editingRefill.pharmacyAddress || '');
    } else {
      reset({
        medicationName: '',
        dosage: '',
        quantity: '',
        pharmacyName: '',
        pharmacyPhone: '',
        pharmacyAddress: '',
        urgency: 'routine',
        notes: '',
      });
      setSelectedAddress('');
    }
  }, [editingRefill, reset]);

  const onSubmit = async (data: RefillRequestFormData) => {
    setLoading(true);
    setError('');

    try {
      // requestedDate is stamped server-side by createRefillRequest.
      const refillData = {
        ...data,
        // Use selectedAddress if available, otherwise use form data
        pharmacyAddress: selectedAddress || data.pharmacyAddress,
        patientId,
        status: 'pending' as const,
      };

      let response;
      if (editingRefill) {
        response = await prescriptionRefillOperations.updateRefillRequest(editingRefill.id, refillData);
      } else {
        response = await prescriptionRefillOperations.createRefillRequest(refillData);
      }

      if (response.success) {
        // Notify admins about new refill request
        if (!editingRefill) {
          const patientName = userProfile
            ? `${userProfile.firstName || ''} ${userProfile.lastName || ''}`.trim()
            : 'A patient';
          await notificationOperations.createNotification({
            recipientRole: 'admin',
            type: 'refill_request',
            title: 'New Refill Request',
            message: `${patientName} — ${data.medicationName} (${data.urgency})`,
            meta: { patientId },
          });
        }

        reset();
        setSelectedAddress('');
        onSuccess();
        onClose();
      } else {
        setError(response.error || 'Failed to save refill request');
      }
    } catch (error: unknown) {
      logger.error('Error saving refill request:', error);
      setError(errorMessage(error) || 'Failed to save refill request');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    reset({
      medicationName: '',
      dosage: '',
      quantity: '',
      pharmacyName: '',
      pharmacyPhone: '',
      pharmacyAddress: '',
      urgency: 'routine',
      notes: '',
    });
    setSelectedAddress('');
    setError('');
    onClose();
  };

  const clearSelectedAddress = () => {
    setSelectedAddress('');
    setValue("pharmacyAddress", '', { shouldValidate: true });
    // Optionally clear the autocomplete input
    if (basicAutocompleteRef.current) {
      const innerInput = basicAutocompleteRef.current.querySelector('input');
      if (innerInput) {
        innerInput.value = '';
      }
    }
  };

  return (
      <Modal
          isOpen={isOpen}
          onClose={handleClose}
          title={editingRefill ? 'Edit Refill Request' : 'New Refill Request'}
          icon={<div className="bg-primary-100 p-2 rounded-lg flex-shrink-0"><Pill className="h-5 w-5 sm:h-6 sm:w-6 text-primary-600" /></div>}
      >
          <form onSubmit={handleSubmit(onSubmit)} className="p-4 sm:p-6 space-y-4 sm:space-y-6">
            <ErrorAlert message={error} />

            {/* Medication Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-secondary-900">Medication Information</h3>

              <div className="space-y-4">
                <Input
                  {...register('medicationName')}
                  label="Medication Name"
                  placeholder="e.g., Lisinopril, Metformin"
                  error={errors.medicationName?.message}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    {...register('dosage')}
                    label="Dosage"
                    placeholder="e.g., 10mg, 500mg twice daily"
                    error={errors.dosage?.message}
                  />

                  <Input
                    {...register('quantity')}
                    label="Quantity"
                    placeholder="e.g., 30 tablets, 90-day supply"
                    error={errors.quantity?.message}
                  />
                </div>
              </div>
            </div>

            {/* Pharmacy Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-secondary-900">Pharmacy Information</h3>

              <div className="space-y-4">
                <div>
                  <PharmacyDropdown
                    value={watch('pharmacyName') || ''} // Use watch to get current value
                    onChange={(value) => setValue('pharmacyName', value, { shouldValidate: true })}
                    label="Pharmacy Name"
                    placeholder="Select a pharmacy"
                    required={true}
                    error={errors.pharmacyName?.message}
                  />
                </div>

                <Input
                  {...register('pharmacyPhone')}
                  label="Pharmacy Phone (Optional)"
                  placeholder="e.g., (555) 123-4567"
                  error={errors.pharmacyPhone?.message}
                />

                {/* Pharmacy Address (with Google Autocomplete) */}
                <div>
                  <Input
                    {...register('pharmacyAddress')}
                    label="Pharmacy Address"
                    placeholder="Start typing address..."
                    error={errors.pharmacyAddress?.message}
                    ref={(e) => {
                      register('pharmacyAddress').ref(e);
                      addressInputRef.current = e;
                    }}
                  />

                  {/* Display selected address */}
                  {selectedAddress && (
                    <div className="mt-2 p-3 bg-secondary-50 border border-secondary-200 rounded-md">
                      <p className="text-sm text-secondary-700">
                        <span className="font-medium">Selected Address:</span> {selectedAddress}
                      </p>
                      <button
                        type="button"
                        onClick={clearSelectedAddress}
                        className="mt-1 text-xs text-red-600 hover:text-red-800 underline"
                      >
                        Clear Selection
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Request Details */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-secondary-900">Request Details</h3>

              <div>
                <label className="block text-sm font-medium text-secondary-700 mb-2">
                  Urgency Level
                </label>
                <select
                  {...register('urgency')}
                  className="input w-full"
                >
                  <option value="routine">Routine (7+ days)</option>
                  <option value="urgent">Urgent (2-6 days)</option>
                  <option value="emergency">Emergency (within 24 hours)</option>
                </select>
                {errors.urgency && (
                  <p className="text-sm text-red-600 mt-1">{errors.urgency.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-secondary-700 mb-2">
                  Additional Notes (Optional)
                </label>
                <textarea
                  {...register('notes')}
                  rows={3}
                  placeholder="Any additional information about this refill request..."
                  className="input w-full resize-none"
                />
                {errors.notes && (
                  <p className="text-sm text-red-600 mt-1">{errors.notes.message}</p>
                )}
              </div>
            </div>

            {/* Form Actions */}
            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center sm:justify-end space-y-reverse space-y-3 sm:space-y-0 sm:space-x-3 pt-4 sm:pt-6 border-t border-secondary-200">
              <Button
                type="button"
                variant="secondary"
                onClick={handleClose}
                disabled={loading}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                loading={loading}
                className="w-full sm:w-auto"
              >
                {editingRefill ? 'Update Request' : 'Submit Request'}
              </Button>
            </div>
          </form>
      </Modal>
  );
};