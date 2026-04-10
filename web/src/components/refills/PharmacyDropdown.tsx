import React, { useState } from 'react';

// List of most popular pharmacy chains in the USA
const POPULAR_PHARMACIES = [
  'CVS Pharmacy',
  'Walgreens',
  'Rite Aid',
  'Walmart Pharmacy',
  'Kroger Pharmacy',
  'Safeway Pharmacy',
  'Meijer Pharmacy',
  'H-E-B Pharmacy',
  'Publix Pharmacy',
  'Giant Eagle Pharmacy',
  'Stop & Shop Pharmacy',
  'Harris Teeter Pharmacy',
  'Wegmans Pharmacy',
  'ShopRite Pharmacy',
  'King Soopers Pharmacy',
  'Fred Meyer Pharmacy',
  'QFC Pharmacy',
  'Dillons Pharmacy',
  'Smith\'s Pharmacy',
  'Ralphs Pharmacy',
  'Fry\'s Pharmacy',
  'Food 4 Less Pharmacy',
  'City Market Pharmacy',
  'Gerbes Pharmacy',
  'Jay C Food Store Pharmacy',
  'Owen\'s Pharmacy',
  'Pay Less Pharmacy',
  'Scott\'s Pharmacy',
  'Costco Pharmacy',
  'Sam\'s Club Pharmacy',
  'Target Pharmacy',
  'Albertsons Pharmacy',
  'Vons Pharmacy',
  'Jewel-Osco Pharmacy',
  'Acme Markets Pharmacy',
  'Shaw\'s Pharmacy',
  'Star Market Pharmacy',
  'United Supermarkets Pharmacy',
  'Market Street Pharmacy',
  'Amigos Pharmacy',
  'Thriftway Pharmacy',
  'Carrs Pharmacy',
  'Randalls Pharmacy',
  'Tom Thumb Pharmacy',
  'Pavilions Pharmacy',
  'Other'
].sort(); // Sort alphabetically

interface PharmacyDropdownProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  label?: string;
  required?: boolean;
  disabled?: boolean;
}

export const PharmacyDropdown: React.FC<PharmacyDropdownProps> = ({
  value,
  onChange,
  error,
  placeholder = "Select a pharmacy",
  label = "Pharmacy Name",
  required = false,
  disabled = false
}) => {
  const [showCustomInput, setShowCustomInput] = useState(
    value === 'Other' || (!POPULAR_PHARMACIES.includes(value) && value !== '')
  );

  const handleDropdownChange = (selectedValue: string) => {
    if (selectedValue === 'Other') {
      setShowCustomInput(true);
      onChange(''); // Clear the value so user can type
    } else {
      setShowCustomInput(false);
      onChange(selectedValue);
    }
  };

  const handleCustomInputChange = (customValue: string) => {
    onChange(customValue);
  };

  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-medium text-secondary-700">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}

      {!showCustomInput ? (
        <select
          value={value}
          onChange={(e) => handleDropdownChange(e.target.value)}
          disabled={disabled}
          className={`input w-full ${error ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}`}
        >
          <option value="">{placeholder}</option>
          {POPULAR_PHARMACIES.map((pharmacy) => (
            <option key={pharmacy} value={pharmacy}>
              {pharmacy}
            </option>
          ))}
        </select>
      ) : (
        <div className="space-y-2">
          <input
            type="text"
            value={value}
            onChange={(e) => handleCustomInputChange(e.target.value)}
            placeholder="Enter pharmacy name..."
            disabled={disabled}
            className={`input w-full ${error ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}`}
          />
          <button
            type="button"
            onClick={() => {
              setShowCustomInput(false);
              onChange('');
            }}
            className="text-xs text-primary-600 hover:text-primary-800 underline"
            disabled={disabled}
          >
            Choose from popular pharmacies instead
          </button>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}
    </div>
  );
};