import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { DocumentUpload } from '../components/documents/DocumentUpload';
import logger from '../lib/logger';
import { useAuth } from '../hooks/useAuth';
import { isAdminRole } from '../lib/roles';
import { SkeletonList } from '../components/ui/Skeleton';
import { PageHeader } from '../components/ui/PageHeader';
import { documentOperations } from '../lib/firestore';
import { PatientDocument, DocumentType } from '../types';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { formatDate } from '../lib/date-helpers';
import {
  Plus,
  FileText,
  Download,
  Trash2,
  CreditCard,
  User as UserIcon,
  Stethoscope,
  FlaskConical,
  FileHeart,
  File,
  Eye,
} from 'lucide-react';
import { formatFileSize, getFileIcon, downloadFile } from '../lib/storage';
import { DocumentPreviewModal } from '../components/documents/DocumentPreviewModal';

const documentTypes: { type: DocumentType; label: string; icon: React.ElementType; description: string }[] = [
  { type: 'drivers_license', label: "Driver's License", icon: UserIcon, description: 'Government issued ID' },
  { type: 'insurance_card_front', label: 'Insurance Card (Front)', icon: CreditCard, description: 'Front side of insurance card' },
  { type: 'insurance_card_back', label: 'Insurance Card (Back)', icon: CreditCard, description: 'Back side of insurance card' },
  { type: 'medical_records', label: 'Medical Records', icon: Stethoscope, description: 'Previous medical records' },
  { type: 'lab_results', label: 'Lab Results', icon: FlaskConical, description: 'Laboratory test results' },
  { type: 'advance_directive', label: 'Advance Directive', icon: FileHeart, description: 'Legal healthcare directives' },
  { type: 'prescription', label: 'Prescriptions', icon: FileText, description: 'Current prescriptions' },
  { type: 'other', label: 'Other Documents', icon: File, description: 'Other medical documents' },
];

export const DocumentsPage: React.FC = () => {
  const { user, userProfile } = useAuth();
  const [documents, setDocuments] = useState<PatientDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [selectedType, setSelectedType] = useState<DocumentType>('other');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [previewDocument, setPreviewDocument] = useState<PatientDocument | null>(null);

  useEffect(() => {
    if (user && userProfile) {
      fetchDocuments();
    }
  }, [user, userProfile]);

  const fetchDocuments = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const response = await documentOperations.getPatientDocuments(user.uid);
      if (response.success && response.data) {
        setDocuments(response.data);
      }
    } catch (error) {
      logger.error('Error fetching documents:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUploadSuccess = () => {
    fetchDocuments();
    setShowUpload(false);
  };

  const handleDeleteDocument = async (documentId: string) => {
    const response = await documentOperations.deleteDocument(documentId);
    if (response.success) {
      fetchDocuments();
    }
    setDeleteConfirmId(null);
  };

  const handleDownload = async (doc: PatientDocument) => {
    try {
      await downloadFile(doc.fileUrl, doc.originalFileName || doc.fileName || 'document');
    } catch (error) {
      logger.error('Error downloading document:', error);
    }
  };

  // Check if document can be previewed
  const isPreviewable = (fileType: string): boolean => {
    return fileType.startsWith('image/') || fileType === 'application/pdf';
  };

  const handlePreview = (doc: PatientDocument) => {
    setPreviewDocument(doc);
  };

  const groupedDocuments = documents.reduce((acc, doc) => {
    if (!acc[doc.documentType]) {
      acc[doc.documentType] = [];
    }
    acc[doc.documentType].push(doc);
    return acc;
  }, {} as Record<DocumentType, PatientDocument[]>);

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonList rows={4} leading="icon" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        backTo="/dashboard"
        icon={FileText}
        title="My Documents"
        subtitle="Upload and manage your medical documents"
        action={(userProfile?.role === 'patient' || isAdminRole(userProfile?.role)) ? (
          <Button onClick={() => setShowUpload(true)} className="flex items-center justify-center w-full sm:w-auto" size="lg">
            <Plus className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />
            Upload
          </Button>
        ) : undefined}
      />

      {/* Document Categories */}
      <div className="grid gap-3">
        {documentTypes.map((docType) => {
          const typeDocuments = groupedDocuments[docType.type] || [];
          const IconComponent = docType.icon;
          const isEmpty = typeDocuments.length === 0;

          return (
            <Card key={docType.type} className={isEmpty ? 'p-3' : 'p-4'}>
              <div className={`flex items-center justify-between ${isEmpty ? '' : 'mb-3'}`}>
                <div className="flex items-center space-x-3 min-w-0">
                  <div className="bg-primary-100 p-2 rounded-lg shrink-0">
                    <IconComponent className="h-5 w-5 text-primary-600" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-secondary-900 truncate">
                      {docType.label}
                    </h3>
                    <p className="text-xs text-secondary-600 truncate">{docType.description}</p>
                  </div>
                </div>
                <span className="text-xs text-secondary-500 shrink-0 ml-2">
                  {typeDocuments.length} doc{typeDocuments.length !== 1 ? 's' : ''}
                </span>
              </div>

              {typeDocuments.length > 0 ? (
                <div className="space-y-3">
                  {typeDocuments.map((document) => (
                    <div
                      key={document.id}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 bg-secondary-50 rounded-lg space-y-3 sm:space-y-0"
                    >
                      <div className="flex items-start space-x-3 min-w-0 flex-1">
                        <span className="text-xl flex-shrink-0">{getFileIcon(document.fileType)}</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-secondary-900 truncate">
                            {document.originalFileName}
                          </p>
                          <div className="flex flex-col sm:flex-row sm:items-center text-sm text-secondary-600 space-y-1 sm:space-y-0 sm:space-x-4">
                            <span className="flex-shrink-0">{formatFileSize(document.fileSize)}</span>
                            <span className="flex-shrink-0">Uploaded {formatDate(document.uploadedAt)}</span>
                            {document.description && (
                              <span className="truncate">• {document.description}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-end space-x-2 flex-shrink-0">
                        {isPreviewable(document.fileType) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handlePreview(document)}
                            className="text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                            title="Preview"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDownload(document)}
                          title="Download"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        {(userProfile?.role === 'patient' || isAdminRole(userProfile?.role)) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteConfirmId(document.id)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>

      <ConfirmModal
        isOpen={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={() => deleteConfirmId && handleDeleteDocument(deleteConfirmId)}
        title="Delete Document"
        message="Are you sure you want to delete this document?"
        confirmLabel="Delete"
        variant="danger"
      />

      {/* Upload Modal */}
      {showUpload && (
        <DocumentUpload
          isOpen={showUpload}
          onClose={() => setShowUpload(false)}
          onSuccess={handleUploadSuccess}
          patientId={user?.uid || ''}
          documentType={selectedType}
          onTypeChange={setSelectedType}
        />
      )}

      <DocumentPreviewModal
        document={previewDocument}
        onClose={() => setPreviewDocument(null)}
      />
    </div>
  );
};
