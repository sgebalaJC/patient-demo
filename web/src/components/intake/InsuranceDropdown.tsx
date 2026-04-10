import React, { useState } from 'react';

const US_INSURANCE_PROVIDERS = [
  'Aetna',
  'Ambetter',
  'Anthem Blue Cross Blue Shield',
  'Blue Cross Blue Shield',
  'CareSource',
  'Centene',
  'Cigna',
  'Devoted Health',
  'Florida Blue',
  'Health Net',
  'Highmark',
  'Humana',
  'Independence Blue Cross',
  'Kaiser Permanente',
  'Medicaid',
  'Medicare',
  'Molina Healthcare',
  'Oscar Health',
  'Oxford Health Plans',
  'TRICARE',
  'UnitedHealthcare',
  'WellCare',
  'Other',
];

interface InsuranceDropdownProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  label?: string;
}

export const InsuranceDropdown: React.FC<InsuranceDropdownProps> = ({
  value,
  onChange,
  error,
  placeholder = 'Select insurance provider',
  label = 'Insurance Provider',
}) => {
  const [showCustomInput, setShowCustomInput] = useState(
    value === 'Other' || (!US_INSURANCE_PROVIDERS.includes(value) && value !== '')
  );

  const handleDropdownChange = (selectedValue: string) => {
    if (selectedValue === 'Other') {
      setShowCustomInput(true);
      onChange('');
    } else {
      setShowCustomInput(false);
      onChange(selectedValue);
    }
  };

  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-medium text-secondary-700">
          {label}
        </label>
      )}

      {!showCustomInput ? (
        <select
          value={value}
          onChange={(e) => handleDropdownChange(e.target.value)}
          className={`input w-full ${error ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}`}
        >
          <option value="">{placeholder}</option>
          {US_INSURANCE_PROVIDERS.map((provider) => (
            <option key={provider} value={provider}>
              {provider}
            </option>
          ))}
        </select>
      ) : (
        <div className="space-y-2">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Enter insurance provider name..."
            className={`input w-full ${error ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}`}
          />
          <button
            type="button"
            onClick={() => {
              setShowCustomInput(false);
              onChange('');
            }}
            className="text-xs text-primary-600 hover:text-primary-800 underline"
          >
            Choose from common providers instead
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
};
