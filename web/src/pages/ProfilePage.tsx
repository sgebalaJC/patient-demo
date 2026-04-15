import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../hooks/useAuth';
import { userOperations } from '../lib/firestore';
import { User, Mail, Phone, Edit2, Save, X, Trash2, AlertTriangle, Shield, CheckCircle, Download } from 'lucide-react';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { PageHeader } from '../components/ui/PageHeader';
import { ErrorAlert } from '../components/ui/ErrorAlert';
import { PhoneVerificationModal } from '../components/ui/PhoneVerificationModal';
import { signOut } from '../lib/firebase';
import { formatPhoneDisplay } from '../lib/phone';
import logger from '../lib/logger';

export const ProfilePage: React.FC = () => {
  const { user, userProfile } = useAuth();
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showPhoneVerification, setShowPhoneVerification] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [exportUrl, setExportUrl] = useState('');
  const [exportError, setExportError] = useState('');
  const [formData, setFormData] = useState({
    firstName: userProfile?.firstName || '',
    lastName: userProfile?.lastName || '',
    phoneNumber: userProfile?.phoneNumber || '',
  });

  React.useEffect(() => {
    if (userProfile) {
      setFormData({
        firstName: userProfile.firstName || '',
        lastName: userProfile.lastName || '',
        phoneNumber: userProfile.phoneNumber || '',
      });
    }
  }, [userProfile]);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSave = async () => {
    if (!user || !userProfile) return;

    // If phone number changed, require verification first
    const phoneChanged = formData.phoneNumber !== (userProfile.phoneNumber || '');
    if (phoneChanged && formData.phoneNumber.trim()) {
      setShowPhoneVerification(true);
      return;
    }

    await saveProfile();
  };

  const saveProfile = async (verifiedPhone?: string) => {
    if (!user || !userProfile) return;

    setLoading(true);
    setError('');

    try {
      const updateData: Record<string, any> = {
        firstName: formData.firstName,
        lastName: formData.lastName,
      };

      // Only include phone if not being updated via verification
      // (verification Cloud Function handles the phone update + calendar sync)
      if (!verifiedPhone) {
        updateData.phoneNumber = formData.phoneNumber;
      }

      const response = await userOperations.updateUser(user.uid, updateData);

      if (response.success) {
        setIsEditing(false);
      } else {
        setError(response.error || 'Failed to update profile');
      }
    } catch (error: any) {
      logger.error('Error updating profile:', error);
      setError(error.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneVerified = (verifiedPhone: string) => {
    setShowPhoneVerification(false);
    setFormData(prev => ({ ...prev, phoneNumber: verifiedPhone }));
    // Save the rest of the profile (name changes) — phone already saved by Cloud Function
    saveProfile(verifiedPhone);
  };

  const handleCancel = () => {
    setFormData({
      firstName: userProfile?.firstName || '',
      lastName: userProfile?.lastName || '',
      phoneNumber: userProfile?.phoneNumber || '',
    });
    setIsEditing(false);
    setError('');
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') return;

    setDeleting(true);
    setDeleteError(null);

    try {
      const { httpsCallable } = await import('firebase/functions');
      const { functions } = await import('../lib/firebase');
      const deleteAccountFn = httpsCallable(functions, 'deleteAccount');
      const result = await deleteAccountFn({}) as { data: { success: boolean; error?: string } };

      if (result.data.success) {
        await signOut();
        navigate('/auth');
      } else {
        setDeleteError(result.data.error || 'Failed to delete account');
      }
    } catch (error: any) {
      logger.error('Error deleting account:', error);
      setDeleteError(error.message || 'Failed to delete account');
    } finally {
      setDeleting(false);
    }
  };

  const handleExportData = async () => {
    if (!user) return;
    setExportStatus('loading');
    setExportError('');
    try {
      const { httpsCallable } = await import('firebase/functions');
      const { functions } = await import('../lib/firebase');
      const exportFn = httpsCallable(functions, 'exportPatientData', { timeout: 300000 });
      const result = await exportFn({}) as { data: { success: boolean; downloadUrl?: string; error?: string; filesSkipped?: boolean } };

      if (result.data.success && result.data.downloadUrl) {
        setExportUrl(result.data.downloadUrl);
        setExportStatus('ready');
        const a = document.createElement('a');
        a.href = result.data.downloadUrl;
        a.download = 'patient-export.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        setExportError(result.data.error || 'Export failed');
        setExportStatus('error');
      }
    } catch (error: any) {
      logger.error('Error exporting data:', error);
      setExportError(error.message || 'Export failed. Please try again later.');
      setExportStatus('error');
    }
  };

  if (!user || !userProfile) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        backTo="/dashboard"
        icon={User}
        iconColor="bg-primary-100 text-primary-600"
        title="Personal information"
      />

      {/* Profile Information */}
      <Card className="p-4 sm:p-6">
        <ErrorAlert message={error} className="mb-4" />

        <div className="space-y-6">
          <div className="flex items-center space-x-4">
            <div className="bg-secondary-100 p-4 rounded-full">
              <User className="h-12 w-12 text-secondary-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-semibold text-secondary-900">
                {`${formData.firstName} ${formData.lastName}`.trim() || 'User'}
              </h2>
            </div>
          </div>

          <div className="space-y-4">
            {/* Email (read-only) */}
            {user.email && (
            <div className="flex items-start space-x-3">
              <Mail className="h-5 w-5 text-secondary-500 mt-2" />
              <div className="flex-1">
                <p className="text-sm font-medium text-secondary-700">Email</p>
                <p className="text-secondary-900">{user.email}</p>
              </div>
            </div>
            )}

            {/* First Name */}
            <div className="flex items-start space-x-3">
              <User className="h-5 w-5 text-secondary-500 mt-2" />
              <div className="flex-1">
                {isEditing ? (
                  <Input
                    label="First Name"
                    value={formData.firstName}
                    onChange={(e) => handleInputChange('firstName', e.target.value)}
                    placeholder="Enter your first name"
                  />
                ) : (
                  <div>
                    <p className="text-sm font-medium text-secondary-700">First Name</p>
                    <p className="text-secondary-900">{formData.firstName || 'Not set'}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Last Name */}
            <div className="flex items-start space-x-3">
              <User className="h-5 w-5 text-secondary-500 mt-2" />
              <div className="flex-1">
                {isEditing ? (
                  <Input
                    label="Last Name"
                    value={formData.lastName}
                    onChange={(e) => handleInputChange('lastName', e.target.value)}
                    placeholder="Enter your last name"
                  />
                ) : (
                  <div>
                    <p className="text-sm font-medium text-secondary-700">Last Name</p>
                    <p className="text-secondary-900">{formData.lastName || 'Not set'}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Phone Number */}
            <div className="flex items-start space-x-3">
              <Phone className="h-5 w-5 text-secondary-500 mt-2" />
              <div className="flex-1">
                {isEditing ? (
                  <Input
                    label="Phone Number"
                    value={formData.phoneNumber}
                    onChange={(e) => handleInputChange('phoneNumber', e.target.value)}
                    placeholder="Enter your phone number"
                    type="tel"
                  />
                ) : (
                  <div>
                    <p className="text-sm font-medium text-secondary-700">Phone Number</p>
                    <div className="flex items-center space-x-2">
                      <p className="text-secondary-900">{formatPhoneDisplay(formData.phoneNumber) || 'Not set'}</p>
                      {formData.phoneNumber && (
                        userProfile?.phoneVerified ? (
                          <span className="inline-flex items-center text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Verified
                          </span>
                        ) : (
                          <button
                            onClick={() => setShowPhoneVerification(true)}
                            className="inline-flex items-center text-xs text-primary-600 hover:text-primary-700 bg-primary-50 px-2 py-0.5 rounded-full font-medium"
                          >
                            <Shield className="h-3 w-3 mr-1" />
                            Verify
                          </button>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-secondary-200">
            {isEditing ? (
              <>
                <Button
                  onClick={handleCancel}
                  variant="secondary"
                  size="md"
                  disabled={loading}
                  className="flex items-center"
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  size="md"
                  loading={loading}
                  className="flex items-center"
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </Button>
              </>
            ) : (
              <Button
                onClick={() => setIsEditing(true)}
                variant="secondary"
                size="md"
                className="flex items-center"
              >
                <Edit2 className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Export Data */}
      <Card className="p-4 sm:p-6">
        <div className="flex items-start space-x-4">
          <div className="bg-primary-100 p-3 rounded-lg flex-shrink-0">
            <Download className="h-6 w-6 text-primary-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-secondary-900">Export My Data</h3>
            <p className="text-sm text-secondary-600 mt-1">
              Download a copy of all your health records, messages, documents, and
              appointments as a ZIP file. You may request one export per hour.
            </p>
            {exportError && <ErrorAlert message={exportError} className="mt-2" />}
            {exportStatus === 'ready' && (
              <p className="text-sm text-green-700 mt-2">
                Export ready.{' '}
                <a href={exportUrl} className="underline font-medium" download="patient-export.zip">
                  Click here
                </a>{' '}
                if download didn&apos;t start automatically.
              </p>
            )}
            <Button
              onClick={handleExportData}
              variant="secondary"
              size="sm"
              loading={exportStatus === 'loading'}
              disabled={exportStatus === 'loading'}
              className="mt-4"
            >
              <Download className="h-4 w-4 mr-2" />
              {exportStatus === 'loading' ? 'Preparing export...' : 'Export My Data'}
            </Button>
          </div>
        </div>
      </Card>

      {/* Delete Account */}
      <Card className="p-4 sm:p-6 border-red-200">
        <div className="flex items-start space-x-4">
          <div className="bg-red-100 p-3 rounded-lg flex-shrink-0">
            <AlertTriangle className="h-6 w-6 text-red-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-secondary-900">Delete Account</h3>
            <p className="text-sm text-secondary-600 mt-1">
              Permanently delete your account and all associated data including messages,
              documents, appointments, and medical records. This action cannot be undone.
            </p>
            <Button
              onClick={() => setShowDeleteModal(true)}
              variant="secondary"
              size="sm"
              className="mt-4 text-red-600 border-red-300 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete My Account
            </Button>
          </div>
        </div>
      </Card>

      {/* Phone Verification Modal */}
      <PhoneVerificationModal
        isOpen={showPhoneVerification}
        phoneNumber={formData.phoneNumber}
        onVerified={handlePhoneVerified}
        onClose={() => setShowPhoneVerification(false)}
      />

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setDeleteConfirmText('');
          setDeleteError(null);
        }}
        title="Delete Account"
        icon={<div className="bg-red-100 p-2 rounded-lg"><AlertTriangle className="h-6 w-6 text-red-600" /></div>}
        maxWidth="max-w-md"
      >
        <div className="p-6 space-y-4">
          <ErrorAlert message={deleteError} />

          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-800 font-medium">This will permanently delete:</p>
            <ul className="text-sm text-red-700 mt-2 space-y-1 list-disc list-inside">
              <li>Your account and profile</li>
              <li>All messages and conversations</li>
              <li>All uploaded documents</li>
              <li>Appointment history</li>
              <li>Prescription refill requests</li>
              <li>Intake forms and medical history</li>
            </ul>
          </div>

          <div>
            <label className="block text-sm font-medium text-secondary-700 mb-2">
              Type <span className="font-bold">DELETE</span> to confirm
            </label>
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Type DELETE"
            />
          </div>

          <div className="flex items-center justify-end space-x-3 pt-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setShowDeleteModal(false);
                setDeleteConfirmText('');
                setDeleteError(null);
              }}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              size="md"
              onClick={handleDeleteAccount}
              disabled={deleteConfirmText !== 'DELETE' || deleting}
              loading={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Account
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
