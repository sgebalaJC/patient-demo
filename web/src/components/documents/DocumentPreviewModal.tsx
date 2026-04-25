/**
 * Full-screen document preview overlay used by both DocumentsPage (patient
 * view) and PatientDocumentManagement (admin view). Image zoom + rotate, PDF
 * iframe via usePdfPreview, download + open-in-new-tab. Lifted out of those
 * two pages so the markup + state machine lives in one place.
 */

import React, { useEffect, useState } from 'react';
import {
  Download,
  ExternalLink,
  File,
  RotateCw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Button } from '../ui/Button';
import {
  downloadFile,
  formatFileSize,
  getFileIcon,
} from '../../lib/storage';
import { usePdfPreview } from '../../hooks/usePdfPreview';
import { errorMessage } from '../../lib/errors';
import logger from '../../lib/logger';
import type { PatientDocument } from '../../types';

interface DocumentPreviewModalProps {
  document: PatientDocument | null;
  onClose: () => void;
}

export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({ document, onClose }) => {
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);

  // Reset zoom/rotation each time a new document is opened.
  useEffect(() => {
    setZoom(100);
    setRotation(0);
  }, [document?.id]);

  const { url: pdfBlobUrl, loading: pdfBlobLoading, error: pdfBlobError } = usePdfPreview(
    async () => {
      if (!document || document.fileType !== 'application/pdf') return null;
      return document.fileUrl;
    },
    [document?.id, document?.fileUrl, document?.fileType],
  );

  if (!document) return null;

  const displayName = document.originalFileName || document.fileName || 'Document';

  const handleDownload = async () => {
    try {
      await downloadFile(document.fileUrl, displayName);
    } catch (error: unknown) {
      logger.error('Error downloading document:', errorMessage(error));
    }
  };

  const handleOpenInNewTab = async () => {
    try {
      const r = await fetch(document.fileUrl);
      const blob = await r.blob();
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (error: unknown) {
      logger.error('Error opening document:', errorMessage(error));
    }
  };

  const isImage = document.fileType.startsWith('image/');
  const isPdf = document.fileType === 'application/pdf';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50">
      <div className="absolute top-0 left-0 right-0 bg-black bg-opacity-50 backdrop-blur-sm p-4 flex items-center justify-between">
        <div className="flex items-center space-x-3 text-white">
          <span className="text-2xl">{getFileIcon(document.fileType)}</span>
          <div>
            <h3 className="font-medium truncate max-w-md">{displayName}</h3>
            <p className="text-sm text-gray-300">
              {formatFileSize(document.fileSize || 0)} • {document.documentType?.replace('_', ' ')}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {isImage && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setZoom((p) => Math.max(p - 25, 25))}
                className="text-white hover:bg-white/20"
                title="Zoom Out"
              >
                <ZoomOut className="h-5 w-5" />
              </Button>
              <span className="text-white text-sm min-w-[60px] text-center">{zoom}%</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setZoom((p) => Math.min(p + 25, 300))}
                className="text-white hover:bg-white/20"
                title="Zoom In"
              >
                <ZoomIn className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRotation((p) => (p + 90) % 360)}
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
            onClick={handleOpenInNewTab}
            className="text-white hover:bg-white/20"
            title="Open in New Tab"
          >
            <ExternalLink className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            className="text-white hover:bg-white/20"
            title="Download"
          >
            <Download className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-white hover:bg-white/20"
            title="Close"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div className="w-full h-full pt-20 pb-4 px-4 flex items-center justify-center overflow-auto">
        {isImage ? (
          <div className="flex items-center justify-center w-full h-full overflow-auto">
            <img
              src={document.fileUrl}
              alt={displayName}
              className="max-w-none object-contain transition-transform duration-200"
              style={{
                transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
                maxHeight: zoom <= 100 ? '100%' : 'none',
                maxWidth: zoom <= 100 ? '100%' : 'none',
              }}
            />
          </div>
        ) : isPdf ? (
          pdfBlobLoading ? (
            <div className="flex items-center justify-center w-full h-full text-white text-sm">Loading PDF…</div>
          ) : pdfBlobError ? (
            <div className="flex flex-col items-center justify-center w-full h-full text-rose-200 text-sm gap-3">
              {pdfBlobError}
              <Button variant="secondary" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                Download instead
              </Button>
            </div>
          ) : pdfBlobUrl ? (
            <iframe
              src={`${pdfBlobUrl}#toolbar=1&navpanes=0`}
              className="w-full h-full bg-white rounded-lg"
              title={displayName}
            />
          ) : null
        ) : (
          <div className="text-center text-white">
            <File className="h-24 w-24 mx-auto mb-4 opacity-50" />
            <p className="text-lg">Preview not available for this file type</p>
            <Button variant="secondary" className="mt-4" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-2" />
              Download to View
            </Button>
          </div>
        )}
      </div>

      {/* Click outside to close */}
      <div className="absolute inset-0 -z-10" onClick={onClose} />
    </div>
  );
};
