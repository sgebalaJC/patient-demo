import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { MedicalHistoryForm } from '../../types';
import { FIELD_LIMITS } from '../../lib/validation';
import { Heart, Plus, X } from 'lucide-react';

const medicalHistorySchema = z.object({
  medicalHistory: z.string().max(FIELD_LIMITS.notes.max).optional().or(z.literal('')),
  hospitalizations: z.string().max(FIELD_LIMITS.notes.max).optional().or(z.literal('')),
  pastSurgicalHistory: z.string().max(FIELD_LIMITS.notes.max).optional().or(z.literal('')),
  currentMedications: z.string().max(FIELD_LIMITS.notes.max).optional().or(z.literal('')),
  allergies: z.array(z.object({
    allergen: z.string().min(1, 'Allergen is required'),
    reaction: z.string().min(1, 'Reaction is required'),
  })),
  smokingStatus: z.enum(['never', 'former', 'current']),
  smokingDetails: z.string().max(FIELD_LIMITS.detailsField.max).optional().or(z.literal('')),
  alcoholConsumption: z.enum(['none', 'occasional', 'moderate', 'heavy']),
  alcoholDetails: z.string().max(FIELD_LIMITS.detailsField.max).optional().or(z.literal('')),
  exerciseFrequency: z.enum(['none', 'rarely', 'weekly', 'daily']),
  exerciseDetails: z.string().max(FIELD_LIMITS.detailsField.max).optional().or(z.literal('')),
});

type MedicalHistoryFormData = z.infer<typeof medicalHistorySchema>;

interface MedicalHistorySectionProps {
  onComplete: (data: MedicalHistoryFormData) => void;
  initialData?: MedicalHistoryForm;
}

export const MedicalHistorySection: React.FC<MedicalHistorySectionProps> = ({
  onComplete,
  initialData,
}) => {
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<MedicalHistoryFormData>({
    resolver: zodResolver(medicalHistorySchema),
    defaultValues: initialData ? {
      medicalHistory: initialData.medicalHistory || '',
      hospitalizations: initialData.hospitalizations || '',
      pastSurgicalHistory: initialData.pastSurgicalHistory || '',
      currentMedications: initialData.currentMedications || '',
      allergies: initialData.allergies || [],
      smokingStatus: initialData.smokingStatus || 'never',
      smokingDetails: initialData.smokingDetails || '',
      alcoholConsumption: initialData.alcoholConsumption || 'none',
      alcoholDetails: initialData.alcoholDetails || '',
      exerciseFrequency: initialData.exerciseFrequency || 'none',
      exerciseDetails: initialData.exerciseDetails || '',
    } : {
      medicalHistory: '',
      hospitalizations: '',
      pastSurgicalHistory: '',
      currentMedications: '',
      allergies: [],
      smokingStatus: 'never',
      smokingDetails: '',
      alcoholConsumption: 'none',
      alcoholDetails: '',
      exerciseFrequency: 'none',
      exerciseDetails: '',
    },
  });

  const watchedValues = watch();

  const addAllergy = () => {
    const current = watchedValues.allergies || [];
    setValue('allergies', [...current, { allergen: '', reaction: '' }]);
  };

  const removeAllergy = (index: number) => {
    const current = watchedValues.allergies || [];
    setValue('allergies', current.filter((_, i) => i !== index));
  };

  const onSubmit = async (data: MedicalHistoryFormData) => {
    setLoading(true);
    try {
      const formData: MedicalHistoryForm = {
        ...data,
        completedAt: new Date() as any,
      };
      onComplete(formData);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-4 sm:p-8">
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center space-y-3 sm:space-y-0 sm:space-x-3 mb-4">
          <div className="bg-red-100 p-2 sm:p-3 rounded-lg flex-shrink-0">
            <Heart className="h-6 w-6 sm:h-8 sm:w-8 text-red-600" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold text-secondary-900 truncate">Medical History</h2>
            <p className="text-secondary-600 text-sm sm:text-base">
              Please provide your medical background and health information
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        {/* Medical History */}
        <div>
          <h3 className="text-lg font-semibold text-secondary-900 mb-2">Medical History</h3>
          <p className="text-sm text-secondary-500 mb-3">List any ongoing or past medical conditions, diagnoses, or chronic illnesses.</p>
          <textarea
            {...register('medicalHistory')}
            placeholder="e.g. Hypertension, Type 2 Diabetes, Asthma..."
            rows={3}
            className="input w-full resize-none"
          />
        </div>

        {/* Hospitalizations */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-lg font-semibold text-secondary-900 mb-2">Hospitalizations</h3>
            <p className="text-sm text-secondary-500 mb-3">List any hospital stays, including reason and approximate date.</p>
            <textarea
              {...register('hospitalizations')}
              placeholder="e.g. Appendectomy - June 2020, Pneumonia - March 2018..."
              rows={4}
              className="input w-full resize-none"
            />
          </div>

          {/* Past Surgical History */}
          <div>
            <h3 className="text-lg font-semibold text-secondary-900 mb-2">Past Surgical History</h3>
            <p className="text-sm text-secondary-500 mb-3">List any surgeries you have had, including approximate date.</p>
            <textarea
              {...register('pastSurgicalHistory')}
              placeholder="e.g. Knee replacement - 2019, Gallbladder removal - 2015..."
              rows={4}
              className="input w-full resize-none"
            />
          </div>
        </div>

        {/* Current Medications */}
        <div>
          <h3 className="text-lg font-semibold text-secondary-900 mb-2">Current Medications</h3>
          <p className="text-sm text-secondary-500 mb-3">List all medications you are currently taking, including dosage and frequency.</p>
          <textarea
            {...register('currentMedications')}
            placeholder="e.g. Metformin 500mg twice daily, Lisinopril 10mg daily..."
            rows={3}
            className="input w-full resize-none"
          />
        </div>

        {/* Allergies */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-secondary-900">Allergies</h3>
              <p className="text-sm text-secondary-500 mt-1">List any known allergies and the reaction they cause.</p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={addAllergy}>
              <Plus className="h-4 w-4 mr-2" />
              Add Allergy
            </Button>
          </div>
          {watchedValues.allergies?.map((_, index) => (
            <div key={index} className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 p-4 border border-secondary-200 rounded-lg">
              <Input
                {...register(`allergies.${index}.allergen`)}
                label="Allergen"
                placeholder="e.g. Penicillin"
                error={errors.allergies?.[index]?.allergen?.message}
              />
              <div className="flex items-end space-x-2">
                <div className="flex-1">
                  <Input
                    {...register(`allergies.${index}.reaction`)}
                    label="Reaction"
                    placeholder="e.g. Hives, swelling"
                    error={errors.allergies?.[index]?.reaction?.message}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => removeAllergy(index)}
                  className="flex-shrink-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          {(!watchedValues.allergies || watchedValues.allergies.length === 0) && (
            <p className="text-secondary-500 italic">No allergies added yet</p>
          )}
        </div>

        {/* Social History */}
        <div>
          <h3 className="text-lg font-semibold text-secondary-900 mb-4">Social History</h3>
          <div className="space-y-6">
            {/* Smoking */}
            <div>
              <label className="block text-sm font-medium text-secondary-700 mb-2">Smoking</label>
              <div className="flex flex-wrap items-center gap-4">
                {(['never', 'former', 'current'] as const).map((value) => (
                  <label key={value} className="flex items-center space-x-2 cursor-pointer">
                    <input
                      {...register('smokingStatus')}
                      type="radio"
                      value={value}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-secondary-300"
                    />
                    <span className="text-sm text-secondary-700 capitalize">{value}</span>
                  </label>
                ))}
                <Input
                  {...register('smokingDetails')}
                  placeholder="Details..."
                  className="flex-1 min-w-[150px]"
                />
              </div>
            </div>

            {/* Alcohol */}
            <div>
              <label className="block text-sm font-medium text-secondary-700 mb-2">Alcohol Use</label>
              <div className="flex flex-wrap items-center gap-4">
                {(['none', 'occasional', 'moderate', 'heavy'] as const).map((value) => (
                  <label key={value} className="flex items-center space-x-2 cursor-pointer">
                    <input
                      {...register('alcoholConsumption')}
                      type="radio"
                      value={value}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-secondary-300"
                    />
                    <span className="text-sm text-secondary-700 capitalize">{value}</span>
                  </label>
                ))}
                <Input
                  {...register('alcoholDetails')}
                  placeholder="Details..."
                  className="flex-1 min-w-[150px]"
                />
              </div>
            </div>

            {/* Exercise */}
            <div>
              <label className="block text-sm font-medium text-secondary-700 mb-2">Exercise</label>
              <div className="flex flex-wrap items-center gap-4">
                {(['none', 'rarely', 'weekly', 'daily'] as const).map((value) => (
                  <label key={value} className="flex items-center space-x-2 cursor-pointer">
                    <input
                      {...register('exerciseFrequency')}
                      type="radio"
                      value={value}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-secondary-300"
                    />
                    <span className="text-sm text-secondary-700 capitalize">{value}</span>
                  </label>
                ))}
                <Input
                  {...register('exerciseDetails')}
                  placeholder="Details..."
                  className="flex-1 min-w-[150px]"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Medical Record Submission */}
        <div>
          <h3 className="text-lg font-semibold text-secondary-900 mb-2">Medical Record Submission</h3>
          <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
            <p className="text-sm text-primary-800">
              Please upload medical records from the past three years, including physician notes,
              laboratory results, imaging studies, mammograms, and records of specialist visits.
            </p>
            <p className="text-sm text-primary-700 mt-2">
              You can upload documents from your <a href="/documents" className="underline font-medium hover:text-primary-900">Documents</a> page after completing the intake form.
            </p>
          </div>
        </div>

        {/* Submit Button */}
        <div className="flex justify-end pt-6 border-t border-secondary-200">
          <Button type="submit" loading={loading} size="lg">
            Complete Medical History
          </Button>
        </div>
      </form>
    </Card>
  );
};
