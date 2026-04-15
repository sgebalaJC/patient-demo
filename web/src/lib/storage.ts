import { 
  ref, 
  uploadBytes, 
  getDownloadURL, 
  deleteObject,
  uploadBytesResumable,
  UploadTaskSnapshot
} from 'firebase/storage';
import { storage } from './firebase';
import { DocumentType } from '../types';
import logger from "./logger";

export interface UploadProgress {
  bytesTransferred: number;
  totalBytes: number;
  progress: number;
}

export interface UploadResult {
  success: boolean;
  fileUrl?: string;
  fileName?: string;
  error?: string;
}

// Storage paths
export const getDocumentPath = (patientId: string, documentType: DocumentType, fileName: string) => {
  return `patients/${patientId}/documents/${documentType}/${fileName}`;
};

// Upload document with progress tracking
export const uploadDocument = (
  file: File,
  patientId: string,
  documentType: DocumentType,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> => {
  return new Promise((resolve) => {
    try {
      // Generate unique filename
      const timestamp = Date.now();
      const fileExtension = file.name.split('.').pop();
      const fileName = `${documentType}_${timestamp}.${fileExtension}`;
      const filePath = getDocumentPath(patientId, documentType, fileName);

      // Create storage reference
      const storageRef = ref(storage, filePath);

      // Create upload task
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on(
        'state_changed',
        (snapshot: UploadTaskSnapshot) => {
          // Progress tracking
          const progress = {
            bytesTransferred: snapshot.bytesTransferred,
            totalBytes: snapshot.totalBytes,
            progress: (snapshot.bytesTransferred / snapshot.totalBytes) * 100
          };
          onProgress?.(progress);
        },
        (error) => {
          // Error handling
          logger.error('Upload error:', error);
          resolve({
            success: false,
            error: error.message || 'Upload failed'
          });
        },
        async () => {
          // Upload completed
          try {
            const fileUrl = await getDownloadURL(uploadTask.snapshot.ref);
            resolve({
              success: true,
              fileUrl,
              fileName
            });
          } catch (error: any) {
            resolve({
              success: false,
              error: error.message || 'Failed to get download URL'
            });
          }
        }
      );
    } catch (error: any) {
      resolve({
        success: false,
        error: error.message || 'Upload initialization failed'
      });
    }
  });
};

// Simple upload without progress tracking
export const uploadDocumentSimple = async (
  file: File,
  patientId: string,
  documentType: DocumentType
): Promise<UploadResult> => {
  try {
    const timestamp = Date.now();
    const fileExtension = file.name.split('.').pop();
    const fileName = `${documentType}_${timestamp}.${fileExtension}`;
    const filePath = getDocumentPath(patientId, documentType, fileName);

    const storageRef = ref(storage, filePath);
    const snapshot = await uploadBytes(storageRef, file);
    const fileUrl = await getDownloadURL(snapshot.ref);

    return {
      success: true,
      fileUrl,
      fileName
    };
  } catch (error: any) {
    logger.error('Simple upload error:', error);
    return {
      success: false,
      error: error.message || 'Upload failed'
    };
  }
};

// Delete document
export const deleteDocument = async (filePath: string): Promise<boolean> => {
  try {
    const storageRef = ref(storage, filePath);
    await deleteObject(storageRef);
    return true;
  } catch (error: any) {
    logger.error('Delete error:', error);
    return false;
  }
};

// Delete message attachment by URL
export const deleteMessageAttachment = async (fileUrl: string): Promise<boolean> => {
  try {
    const storageRef = ref(storage, fileUrl);
    await deleteObject(storageRef);
    return true;
  } catch (error: any) {
    logger.error('Delete message attachment error:', error);
    return false;
  }
};

// Delete multiple message attachments
export const deleteMessageAttachments = async (attachments: Array<{ url: string; name: string }>): Promise<{ success: boolean; errors: string[] }> => {
  const errors: string[] = [];

  for (const attachment of attachments) {
    try {
      const success = await deleteMessageAttachment(attachment.url);
      if (!success) {
        errors.push(`Failed to delete ${attachment.name}`);
      }
    } catch (error: any) {
      errors.push(`Error deleting ${attachment.name}: ${error.message}`);
    }
  }

  return {
    success: errors.length === 0,
    errors
  };
};

// Get message attachment path
export const getMessageAttachmentPath = (threadId: string, fileName: string) => {
  return `messages/${threadId}/attachments/${fileName}`;
};

// Chat attachments path — for AI chat (admin agent + patient support).
// Scoped per-uploader (`senderId`) so Firestore rules can enforce write owner.
export const getChatAttachmentPath = (senderId: string, attachmentId: string, fileName: string) => {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `chat-attachments/${senderId}/${attachmentId}/${safeName}`;
};

/** Upload a chat attachment (image, doc, etc.). Returns the download URL +
 *  storage path so callers can persist both for later cleanup. */
export const uploadChatAttachment = async (
  file: File,
  senderId: string,
): Promise<{ url: string; storagePath: string; name: string; mimeType: string; size: number }> => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = getChatAttachmentPath(senderId, id, file.name);
  const storageRef = ref(storage, path);
  const snap = await uploadBytes(storageRef, file);
  const url = await getDownloadURL(snap.ref);
  return { url, storagePath: path, name: file.name, mimeType: file.type, size: file.size };
};

// Upload message attachment
export const uploadMessageAttachment = (
  file: File,
  threadId: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> => {
  return new Promise((resolve) => {
    try {
      // Generate unique filename
      const timestamp = Date.now();
      const originalName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const fileName = `${timestamp}_${originalName}`;
      const filePath = getMessageAttachmentPath(threadId, fileName);

      // Create storage reference
      const storageRef = ref(storage, filePath);

      // Create upload task
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on(
        'state_changed',
        (snapshot: UploadTaskSnapshot) => {
          // Progress tracking
          const progress = {
            bytesTransferred: snapshot.bytesTransferred,
            totalBytes: snapshot.totalBytes,
            progress: (snapshot.bytesTransferred / snapshot.totalBytes) * 100
          };
          onProgress?.(progress);
        },
        (error) => {
          // Error handling
          logger.error('Upload error:', error);
          resolve({
            success: false,
            error: error.message || 'Upload failed'
          });
        },
        async () => {
          // Upload completed
          try {
            const fileUrl = await getDownloadURL(uploadTask.snapshot.ref);
            resolve({
              success: true,
              fileUrl,
              fileName: originalName
            });
          } catch (error: any) {
            resolve({
              success: false,
              error: error.message || 'Failed to get download URL'
            });
          }
        }
      );
    } catch (error: any) {
      resolve({
        success: false,
        error: error.message || 'Upload initialization failed'
      });
    }
  });
};

// Shared allowed file types
const IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff'];
const PDF_TYPES = ['application/pdf'];
const DOCUMENT_TYPES = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];
const TEXT_TYPES = ['text/plain', 'text/csv'];
const MEDICAL_TYPES = ['application/dicom'];

interface ValidateFileOptions {
  maxSizeMB: number;
  allowedTypes: string[];
  errorMessage?: string;
}

// Unified file validation
export const validateFile = (file: File, options: ValidateFileOptions): { valid: boolean; error?: string } => {
  const maxSize = options.maxSizeMB * 1024 * 1024;
  if (file.size > maxSize) {
    return { valid: false, error: `File size must be less than ${options.maxSizeMB}MB` };
  }

  if (!options.allowedTypes.includes(file.type)) {
    return { valid: false, error: options.errorMessage || 'File type not supported.' };
  }

  return { valid: true };
};

// Validate message attachment file (25MB, broad types)
export const validateMessageAttachment = (file: File): { valid: boolean; error?: string } => {
  return validateFile(file, {
    maxSizeMB: 25,
    allowedTypes: [...IMAGE_TYPES, ...PDF_TYPES, ...DOCUMENT_TYPES, ...TEXT_TYPES, ...MEDICAL_TYPES],
    errorMessage: 'File type not supported. Please upload images, PDFs, or common document formats.',
  });
};

// Validate patient document file (10MB, images + PDF + Word)
export const validateDocumentFile = (file: File): { valid: boolean; error?: string } => {
  return validateFile(file, {
    maxSizeMB: 10,
    allowedTypes: [...IMAGE_TYPES.slice(0, 3), ...PDF_TYPES, ...DOCUMENT_TYPES.slice(0, 2)],
    errorMessage: 'File type not supported. Please upload images, PDF, or Word documents.',
  });
};

// Get file icon based on type
export const getFileIcon = (fileType: string): string => {
  if (fileType.startsWith('image/')) {
    return '🖼️';
  } else if (fileType === 'application/pdf') {
    return '📄';
  } else if (fileType.includes('word') || fileType.includes('document')) {
    return '📝';
  }
  return '📎';
};

// Format file size
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
