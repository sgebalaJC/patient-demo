import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { User, PatientDocument } from '../../types';
import { documentOperations } from '../../lib/firestore';
import {
  Download,
  Trash2,
  FileText,
  Image,
  File,
  Eye,
} from 'lucide-react';
import logger from '../../lib/logger';
import { audit } from '../../lib/audit';
import { Modal } from '../ui/Modal';
import { ConfirmModal } from '../ui/ConfirmModal';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { useSimulationMode } from '../../hooks/useSimulationMode';
import { downloadFile, formatFileSize } from '../../lib/storage';
import { formatDateTime, toDate } from '../../lib/date-helpers';
import { DocumentPreviewModal } from '../documents/DocumentPreviewModal';

interface PatientDocumentManagementProps {
  isOpen: boolean;
  onClose: () => void;
  patient: User | null;
}

export const PatientDocumentManagement: React.FC<PatientDocumentManagementProps> = ({
  isOpen,
  onClose,
  patient,
}) => {
  const [documents, setDocuments] = useState<PatientDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [previewDocument, setPreviewDocument] = useState<PatientDocument | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { enabled: simulated } = useSimulationMode();

  useEffect(() => {
    if (isOpen && patient) {
      fetchDocuments();
    }
    // fetchDocuments closes over `patient` + `simulated` (already in deps)
    // and `setDocuments`/`setLoading`/`setActionError` (stable). Disable
    // the rule because adding the function reference would re-run on
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, patient, simulated]);

  const fetchDocuments = async () => {
    if (!patient) return;

    setLoading(true);
    try {
      // PII intentionally not logged — UID + role only per CLAUDE.md.
      logger.log('[PatientDocumentManagement] Fetching documents', { patientId: patient.id });

      const response = await documentOperations.getPatientDocuments(patient.id, simulated);

      logger.log('[PatientDocumentManagement] API response', {
        success: response.success,
        dataLength: response.data?.length || 0,
        hasError: !!response.error,
      });
      
      if (response.success && response.data) {
        setDocuments(response.data);
        logger.log('✅ [PatientDocumentManagement] Documents set successfully:', response.data.length);
      } else {
        logger.error('❌ [PatientDocumentManagement] Failed to fetch documents:', response.error);
        setDocuments([]);
      }
    } catch (error) {
      logger.error('❌ [PatientDocumentManagement] Error fetching documents:', error);
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (doc: PatientDocument) => {
    try {
      await downloadFile(doc.fileUrl, doc.fileName || doc.originalFileName || 'document');
      audit({
        action: 'document.downloaded',
        resourceType: 'patient-document',
        resourceId: doc.id,
        metadata: { patientId: patient?.id, documentType: doc.documentType },
      });
    } catch (error) {
      logger.error('Error downloading document:', error);
      setActionError('Failed to download document. Please try again.');
    }
  };

  const handleDelete = async (documentId: string) => {
    setDeleting(documentId);
    setDeleteConfirmId(null);
    try {
      logger.log('🗑️ [PatientDocumentManagement] Deleting document:', documentId);
      
      const response = await documentOperations.deleteDocument(documentId);
      
      if (response.success) {
        logger.log('✅ [PatientDocumentManagement] Document deleted successfully');
        // Remove the document from the local state
        setDocuments(prev => prev.filter(doc => doc.id !== documentId));
      } else {
        logger.error('❌ [PatientDocumentManagement] Failed to delete document:', response.error);
        setActionError(`Failed to delete document: ${response.error}`);
      }
    } catch (error) {
      logger.error('❌ [PatientDocumentManagement] Error deleting document:', error);
      setActionError('Failed to delete document. Please try again.');
    } finally {
      setDeleting(null);
    }
  };

  const getFileIcon = (fileType: string) => {
    if (fileType.startsWith('image/')) {
      return <Image className="h-5 w-5 text-green-600" />;
    } else if (fileType === 'application/pdf') {
      return <FileText className="h-5 w-5 text-red-600" />;
    } else {
      return <File className="h-5 w-5 text-blue-600" />;
    }
  };

  // Check if document can be previewed
  const isPreviewable = (fileType: string): boolean => {
    return fileType.startsWith('image/') || fileType === 'application/pdf';
  };

  const handlePreview = (doc: PatientDocument) => {
    setPreviewDocument(doc);
    audit({
      action: 'document.viewed',
      resourceType: 'patient-document',
      resourceId: doc.id,
      metadata: { patientId: patient?.id, documentType: doc.documentType, viewedBy: 'admin' },
    });
  };

  const formatDate = (timestamp: unknown): string =>
    timestamp ? formatDateTime(toDate(timestamp as Parameters<typeof toDate>[0])) : 'Unknown';

  return (
    <>
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={patient ? `Patient Documents - ${`${patient.firstName || ''} ${patient.lastName || ''}`.trim() || 'Unknown Patient'}` : 'Patient Documents'}
      icon={<div className="bg-primary-100 p-2 rounded-lg"><FileText className="h-6 w-6 text-primary-600" /></div>}
      maxWidth="max-w-4xl"
    >
        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          <ErrorAlert message={actionError} className="mb-4" />
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-3">
              <LoadingSpinner size="lg" className="" />
              <span className="text-secondary-600">Loading documents...</span>
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-16 w-16 text-secondary-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-secondary-900 mb-2">
                No Documents Found
              </h3>
              <p className="text-secondary-600">
                This patient hasn't uploaded any documents yet.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-secondary-900">
                  {documents.length} Document{documents.length !== 1 ? 's' : ''}
                </h3>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={fetchDocuments}
                  className="flex items-center"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {documents.map((document) => (
                  <Card key={document.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-3 flex-1">
                        <div className="flex-shrink-0">
                          {getFileIcon(document.fileType)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-medium text-secondary-900 truncate">
                            {document.fileName || document.originalFileName || 'Unknown Document'}
                          </h4>
                          <div className="flex items-center space-x-4 mt-1 text-xs text-secondary-500">
                            <span>{formatFileSize(document.fileSize || 0)}</span>
                            <span>•</span>
                            <span>{formatDate(document.uploadedAt)}</span>
                            {document.documentType && (
                              <>
                                <span>•</span>
                                <span className="capitalize">{document.documentType.replace('_', ' ')}</span>
                              </>
                            )}
                          </div>
                          {document.description && (
                            <p className="text-xs text-secondary-600 mt-1 line-clamp-2">
                              {document.description}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 flex-shrink-0">
                        {isPreviewable(document.fileType) && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handlePreview(document)}
                            className="text-purple-600 hover:text-purple-700"
                            title="Preview"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleDownload(document)}
                          className="text-blue-600 hover:text-blue-700"
                          title="Download"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setDeleteConfirmId(document.id)}
                          disabled={deleting === document.id}
                          className="text-red-600 hover:text-red-700"
                          title="Delete"
                        >
                          {deleting === document.id ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b border-red-600"></div>
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 p-6 border-t border-secondary-200 bg-secondary-50">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>

    </Modal>

    <DocumentPreviewModal
      document={previewDocument}
      onClose={() => setPreviewDocument(null)}
    />

    <ConfirmModal
      isOpen={!!deleteConfirmId}
      onClose={() => setDeleteConfirmId(null)}
      onConfirm={() => deleteConfirmId && handleDelete(deleteConfirmId)}
      title="Delete Document"
      message="Are you sure you want to delete this document? This action cannot be undone."
      confirmLabel="Delete"
      variant="danger"
    />
    </>
  );
};
