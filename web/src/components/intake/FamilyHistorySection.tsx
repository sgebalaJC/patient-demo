import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { FamilyHistoryForm, FAMILY_HISTORY_CONDITIONS, FamilyRelation } from '../../types';
import { FIELD_LIMITS } from '../../lib/validation';
import { Users, X } from 'lucide-react';

const RELATIONS: { value: FamilyRelation; label: string }[] = [
  { value: 'mother', label: 'Mother' },
  { value: 'father', label: 'Father' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'grandparent', label: 'Grandparent' },
  { value: 'other', label: 'Other' },
];

const familyHistorySchema = z.object({
  conditions: z.array(z.object({
    condition: z.string().min(1),
    relation: z.enum(['mother', 'father', 'sibling', 'grandparent', 'other']),
    details: z.string().max(FIELD_LIMITS.detailsField.max).optional().or(z.literal('')),
  })),
  otherHistory: z.string().max(FIELD_LIMITS.notes.max).optional().or(z.literal('')),
});

type FamilyHistoryFormData = z.infer<typeof familyHistorySchema>;

interface FamilyHistorySectionProps {
  onComplete: (data: FamilyHistoryFormData) => void;
  initialData?: FamilyHistoryForm;
}

export const FamilyHistorySection: React.FC<FamilyHistorySectionProps> = ({
  onComplete,
  initialData,
}) => {
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
  } = useForm<FamilyHistoryFormData>({
    resolver: zodResolver(familyHistorySchema),
    defaultValues: initialData ? {
      conditions: initialData.conditions || [],
      otherHistory: initialData.otherHistory || '',
    } : {
      conditions: [],
      otherHistory: '',
    },
  });

  const watchedConditions = watch('conditions');

  const isConditionAdded = (condition: string) =>
    watchedConditions?.some(c => c.condition === condition) ?? false;

  const toggleCondition = (condition: string) => {
    const current = watchedConditions || [];
    if (isConditionAdded(condition)) {
      setValue('conditions', current.filter(c => c.condition !== condition));
    } else {
      setValue('conditions', [...current, { condition, relation: 'mother' as FamilyRelation, details: '' }]);
    }
  };

  const updateRelation = (index: number, relation: FamilyRelation) => {
    const current = [...(watchedConditions || [])];
    current[index] = { ...current[index], relation };
    setValue('conditions', current);
  };

  const removeCondition = (index: number) => {
    const current = watchedConditions || [];
    setValue('conditions', current.filter((_, i) => i !== index));
  };

  const onSubmit = async (data: FamilyHistoryFormData) => {
    setLoading(true);
    try {
      const formData: FamilyHistoryForm = {
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
          <div className="bg-purple-100 p-2 sm:p-3 rounded-lg flex-shrink-0">
            <Users className="h-6 w-6 sm:h-8 sm:w-8 text-purple-600" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold text-secondary-900 truncate">Family History</h2>
            <p className="text-secondary-600 text-sm sm:text-base">
              Select any conditions that run in your family
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        {/* Condition Checklist */}
        <div>
          <h3 className="text-lg font-semibold text-secondary-900 mb-2">Family Conditions</h3>
          <p className="text-sm text-secondary-500 mb-4">
            Check any conditions that have been diagnosed in your immediate family members.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {FAMILY_HISTORY_CONDITIONS.map((condition) => (
              <label
                key={condition}
                className={`flex items-center space-x-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  isConditionAdded(condition)
                    ? 'border-primary-300 bg-primary-50'
                    : 'border-secondary-200 hover:border-secondary-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isConditionAdded(condition)}
                  onChange={() => toggleCondition(condition)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-secondary-300 rounded"
                />
                <span className="text-sm text-secondary-800">{condition}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Selected conditions with relation details */}
        {watchedConditions && watchedConditions.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-secondary-900 mb-2">Details</h3>
            <p className="text-sm text-secondary-500 mb-4">
              For each condition, select which family member was affected.
            </p>
            <div className="space-y-3">
              {watchedConditions.map((entry, index) => (
                <div key={entry.condition} className="flex items-center gap-3 p-3 border border-secondary-200 rounded-lg">
                  <span className="text-sm font-medium text-secondary-900 min-w-[180px]">{entry.condition}</span>
                  <select
                    value={entry.relation}
                    onChange={(e) => updateRelation(index, e.target.value as FamilyRelation)}
                    className="input text-sm py-1.5 flex-shrink-0"
                  >
                    {RELATIONS.map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                  <input
                    {...register(`conditions.${index}.details`)}
                    placeholder="Details (optional)"
                    className="input text-sm py-1.5 flex-1 min-w-0"
                  />
                  <Button type="button" variant="secondary" size="sm" onClick={() => removeCondition(index)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Other / Free text */}
        <div>
          <h3 className="text-lg font-semibold text-secondary-900 mb-2">Other Family History</h3>
          <p className="text-sm text-secondary-500 mb-3">
            Describe any other family health conditions not listed above.
          </p>
          <textarea
            {...register('otherHistory')}
            placeholder="e.g. My maternal grandmother had rheumatoid arthritis..."
            rows={3}
            className="input w-full resize-none"
          />
        </div>

        {/* Submit */}
        <div className="flex justify-end pt-6 border-t border-secondary-200">
          <Button type="submit" loading={loading} size="lg">
            Complete Family History
          </Button>
        </div>
      </form>
    </Card>
  );
};
