import { useMemo } from 'react';
import { 
  featureConfig, 
  isFeatureEnabled,
  canManageUsers,
  canUseAppointments,
  canUseMessages,
  canUsePrescriptions,
  canUseDocuments,
  canUsePatientIntake,
  canUseAdminTools,
  canUseAdminTodos
} from '../config/features';

/**
 * React hook for accessing feature configuration
 */
export const useFeatures = () => {
  const features = useMemo(() => featureConfig, []);

  return {
    // Direct access to config
    config: features,

    // Feature checkers
    isEnabled: isFeatureEnabled,

    // Specific feature helpers
    canManageUsers,
    canUseAppointments,
    canUseMessages,
    canUsePrescriptions,
    canUseDocuments,
    canUsePatientIntake,
    canUseAdminTools,
    canUseAdminTodos,

    // Quick access to features
    features,
  };
};

export default useFeatures;
