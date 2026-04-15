/**
 * Feature Configuration
 * Central place to control what functionality is enabled/disabled
 */

export interface FeatureConfig {
  userManagement: boolean;
  appointments: boolean;
  messages: boolean;
  prescriptions: boolean;
  documents: boolean;
  patientIntake: boolean;
  adminTools: boolean;
}

// Default configuration - modify these values to enable/disable features
export const featureConfig: FeatureConfig = {
  userManagement: true,
  appointments: true,
  messages: true,
  prescriptions: true,
  documents: true,
  patientIntake: true,
  adminTools: true,
};

// Helper functions to check specific features
export const isFeatureEnabled = (feature: keyof FeatureConfig): boolean => {
  return featureConfig[feature];
};

// Specific feature checkers for common use cases
export const canManageUsers = () => featureConfig.userManagement;
export const canUseAppointments = () => featureConfig.appointments;
export const canUseMessages = () => featureConfig.messages;
export const canUsePrescriptions = () => featureConfig.prescriptions;
export const canUseDocuments = () => featureConfig.documents;
export const canUsePatientIntake = () => featureConfig.patientIntake;
export const canUseAdminTools = () => featureConfig.adminTools;

// Export the config for direct access if needed
export default featureConfig;
