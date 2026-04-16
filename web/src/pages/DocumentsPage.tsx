import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { DocumentUpload } from '../components/documents/DocumentUpload';
import logger from '../lib/logger';
import { useAuth } from '../hooks/useAuth';
import { isAdminRole } from '../lib/roles';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { PageHeader } from '../components/ui/PageHeader';
import { documentOperations } from '../lib/firestore';
import { PatientDocument, DocumentType } from '../types';
import { ConfirmModal } from '../components/ui/ConfirmModal';
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
  X,
  ZoomIn,
  ZoomOut,
  RotateCw,
  ExternalLink
} from 'lucide-react';
import { formatFileSize, getFileIcon } from '../lib/storage';

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
  const [imageZoom, setImageZoom] = useState(100);
  const [imageRotation, setImageRotation] = useState(0);

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

  const openDocument = (url: string) => {
    window.open(url, '_blank');
  };

  // Check if document can be previewed
  const isPreviewable = (fileType: string): boolean => {
    return fileType.startsWith('image/') || fileType === 'application/pdf';
  };

  // Handle preview
  const handlePreview = (doc: PatientDocument) => {
    setPreviewDocument(doc);
    setImageZoom(100);
    setImageRotation(0);
  };

  const closePreview = () => {
    setPreviewDocument(null);
    setImageZoom(100);
    setImageRotation(0);
  };

  const handleZoomIn = () => {
    setImageZoom(prev => Math.min(prev + 25, 300));
  };

  const handleZoomOut = () => {
    setImageZoom(prev => Math.max(prev - 25, 25));
  };

  const handleRotate = () => {
    setImageRotation(prev => (prev + 90) % 360);
  };

  const groupedDocuments = documents.reduce((acc, doc) => {
    if (!acc[doc.documentType]) {
      acc[doc.documentType] = [];
    }
    acc[doc.documentType].push(doc);
    return acc;
  }, {} as Record<DocumentType, PatientDocument[]>);

  if (loading) {
    return <LoadingSpinner />;
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
                            <span className="flex-shrink-0">Uploaded {document.uploadedAt?.toDate?.()?.toLocaleDateString()}</span>
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
                          onClick={() => openDocument(document.fileUrl)}
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

      {/* Document Preview Modal */}
      {previewDocument && (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50">
          {/* Header */}
          <div className="absolute top-0 left-0 right-0 bg-black bg-opacity-50 backdrop-blur-sm p-4 flex items-center justify-between">
            <div className="flex items-center space-x-3 text-white">
              <span className="text-2xl">{getFileIcon(previewDocument.fileType)}</span>
              <div>
                <h3 className="font-medium truncate max-w-md">
                  {previewDocument.originalFileName || previewDocument.fileName || 'Document'}
                </h3>
                <p className="text-sm text-gray-300">
                  {formatFileSize(previewDocument.fileSize || 0)} • {previewDocument.documentType?.replace('_', ' ')}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              {/* Controls for images */}
              {previewDocument.fileType.startsWith('image/') && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleZoomOut}
                    className="text-white hover:bg-white/20"
                    title="Zoom Out"
                  >
                    <ZoomOut className="h-5 w-5" />
                  </Button>
                  <span className="text-white text-sm min-w-[60px] text-center">{imageZoom}%</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleZoomIn}
                    className="text-white hover:bg-white/20"
                    title="Zoom In"
                  >
                    <ZoomIn className="h-5 w-5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRotate}
                    className="text-white hover:bg-white/20"
                    title="Rotate"
                  >
                    <RotateCw className="h-5 w-5" />
                  </Button>
                  <div className="w-px h-6 bg-white/30 mx-2" />
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.open(previewDocument.fileUrl, '_blank')}
                className="text-white hover:bg-white/20"
                title="Open in New Tab"
              >
                <ExternalLink className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openDocument(previewDocument.fileUrl)}
                className="text-white hover:bg-white/20"
                title="Download"
              >
                <Download className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={closePreview}
                className="text-white hover:bg-white/20"
                title="Close"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>

          {/* Preview Content */}
          <div className="w-full h-full pt-20 pb-4 px-4 flex items-center justify-center overflow-auto">
            {previewDocument.fileType.startsWith('image/') ? (
              <div className="flex items-center justify-center w-full h-full overflow-auto">
                <img
                  src={previewDocument.fileUrl}
                  alt={previewDocument.originalFileName || 'Document preview'}
                  className="max-w-none object-contain transition-transform duration-200"
                  style={{
                    transform: `scale(${imageZoom / 100}) rotate(${imageRotation}deg)`,
                    maxHeight: imageZoom <= 100 ? '100%' : 'none',
                    maxWidth: imageZoom <= 100 ? '100%' : 'none',
                  }}
                />
              </div>
            ) : previewDocument.fileType === 'application/pdf' ? (
              <iframe
                src={`${previewDocument.fileUrl}#toolbar=1&navpanes=0`}
                className="w-full h-full bg-white rounded-lg"
                title={previewDocument.originalFileName || 'PDF Preview'}
              />
            ) : (
              <div className="text-center text-white">
                <File className="h-24 w-24 mx-auto mb-4 opacity-50" />
                <p className="text-lg">Preview not available for this file type</p>
                <Button
                  variant="secondary"
                  className="mt-4"
                  onClick={() => openDocument(previewDocument.fileUrl)}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download to View
                </Button>
              </div>
            )}
          </div>

          {/* Click outside to close */}
          <div 
            className="absolute inset-0 -z-10" 
            onClick={closePreview}
          />
        </div>
      )}
    </div>
  );
};
