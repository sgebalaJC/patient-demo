import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { User, PatientDocument } from '../../types';
import { documentOperations } from '../../lib/firestore';
import { 
  X, 
  Download, 
  Trash2, 
  FileText, 
  Image, 
  File,
  Eye,
  ZoomIn,
  ZoomOut,
  RotateCw,
  ExternalLink
} from 'lucide-react';
import logger from '../../lib/logger';
import { Modal } from '../ui/Modal';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useSimulationMode } from '../../hooks/useSimulationMode';
import { usePdfPreview } from '../../hooks/usePdfPreview';
import { downloadFile, formatFileSize } from '../../lib/storage';
import { formatDateTime, toDate } from '../../lib/date-helpers';

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
  const [imageZoom, setImageZoom] = useState(100);
  const [imageRotation, setImageRotation] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const { enabled: simulated } = useSimulationMode();
  const { url: pdfBlobUrl, loading: pdfBlobLoading, error: pdfBlobError } = usePdfPreview(
    async () => {
      if (!previewDocument || previewDocument.fileType !== 'application/pdf') return null;
      return previewDocument.fileUrl;
    },
    [previewDocument?.id, previewDocument?.fileUrl, previewDocument?.fileType],
  );

  useEffect(() => {
    if (isOpen && patient) {
      fetchDocuments();
    }
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
      logger.log('📥 [PatientDocumentManagement] Downloading document:', doc.id);
      await downloadFile(doc.fileUrl, doc.fileName || doc.originalFileName || 'document');
      logger.log('✅ [PatientDocumentManagement] Download initiated');
    } catch (error) {
      logger.error('❌ [PatientDocumentManagement] Error downloading document:', error);
      setActionError('Failed to download document. Please try again.');
    }
  };

  const handleOpenInNewTab = async (doc: PatientDocument) => {
    try {
      const r = await fetch(doc.fileUrl);
      const blob = await r.blob();
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (error) {
      logger.error('❌ [PatientDocumentManagement] Error opening document:', error);
      setActionError('Failed to open document. Please try again.');
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
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
              <span className="ml-3 text-secondary-600">Loading documents...</span>
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

      {/* Document Preview Modal */}
      {previewDocument && (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[60]">
          {/* Header */}
          <div className="absolute top-0 left-0 right-0 bg-black bg-opacity-50 backdrop-blur-sm p-4 flex items-center justify-between">
            <div className="flex items-center space-x-3 text-white">
              {getFileIcon(previewDocument.fileType)}
              <div>
                <h3 className="font-medium truncate max-w-md">
                  {previewDocument.fileName || previewDocument.originalFileName || 'Document'}
                </h3>
                <p className="text-sm text-secondary-300">
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
                onClick={() => handleOpenInNewTab(previewDocument)}
                className="text-white hover:bg-white/20"
                title="Open in New Tab"
              >
                <ExternalLink className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDownload(previewDocument)}
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
                  alt={previewDocument.fileName || 'Document preview'}
                  className="max-w-none object-contain transition-transform duration-200"
                  style={{
                    transform: `scale(${imageZoom / 100}) rotate(${imageRotation}deg)`,
                    maxHeight: imageZoom <= 100 ? '100%' : 'none',
                    maxWidth: imageZoom <= 100 ? '100%' : 'none',
                  }}
                />
              </div>
            ) : previewDocument.fileType === 'application/pdf' ? (
              pdfBlobLoading ? (
                <div className="flex items-center justify-center w-full h-full text-white text-sm">
                  Loading PDF…
                </div>
              ) : pdfBlobError ? (
                <div className="flex flex-col items-center justify-center w-full h-full text-rose-200 text-sm gap-3">
                  {pdfBlobError}
                  <Button variant="secondary" onClick={() => handleDownload(previewDocument)}>
                    <Download className="h-4 w-4 mr-2" />
                    Download instead
                  </Button>
                </div>
              ) : pdfBlobUrl ? (
                <iframe
                  src={`${pdfBlobUrl}#toolbar=1&navpanes=0`}
                  className="w-full h-full bg-white rounded-lg"
                  title={previewDocument.fileName || 'PDF Preview'}
                />
              ) : null
            ) : (
              <div className="text-center text-white">
                <File className="h-24 w-24 mx-auto mb-4 opacity-50" />
                <p className="text-lg">Preview not available for this file type</p>
                <Button
                  variant="secondary"
                  className="mt-4"
                  onClick={() => handleDownload(previewDocument)}
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
    </Modal>

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
