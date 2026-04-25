import React, {useState, useCallback} from 'react';
import {useDropzone} from 'react-dropzone';
import {Upload, FileText} from 'lucide-react';
import {Button} from '../ui/Button';
import {ErrorAlert} from '../ui/ErrorAlert';
import {Input} from '../ui/Input';
import {DocumentType, PatientDocument} from '../../types';
import {uploadDocument, validateDocumentFile, UploadProgress} from '../../lib/storage';
import {documentOperations} from '../../lib/firestore';
import logger from "../../lib/logger";
import { errorMessage } from "../../lib/errors";
import { Modal } from '../ui/Modal';

const documentTypes: { value: DocumentType; label: string }[] = [
    {value: 'drivers_license', label: "Driver's License"},
    {value: 'insurance_card_front', label: 'Insurance Card (Front)'},
    {value: 'insurance_card_back', label: 'Insurance Card (Back)'},
    {value: 'medical_records', label: 'Medical Records'},
    {value: 'lab_results', label: 'Lab Results'},
    {value: 'advance_directive', label: 'Advance Directive'},
    {value: 'prescription', label: 'Prescriptions'},
    {value: 'other', label: 'Other Documents'},
];

interface DocumentUploadProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    patientId: string;
    documentType: DocumentType;
    onTypeChange: (type: DocumentType) => void;
}

export const DocumentUpload: React.FC<DocumentUploadProps> = ({
                                                                  isOpen,
                                                                  onClose,
                                                                  onSuccess,
                                                                  patientId,
                                                                  documentType,
                                                                  onTypeChange,
                                                              }) => {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [description, setDescription] = useState('');
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
    const [error, setError] = useState<string>('');

    const onDrop = useCallback((acceptedFiles: File[]) => {
        const file = acceptedFiles[0];
        if (file) {
            const validation = validateDocumentFile(file);
            if (validation.valid) {
                setSelectedFile(file);
                setError('');
            } else {
                setError(validation.error || 'Invalid file');
            }
        }
    }, []);

    const {getRootProps, getInputProps, isDragActive} = useDropzone({
        onDrop,
        accept: {
            'image/*': ['.jpeg', '.jpg', '.png', '.gif'],
            'application/pdf': ['.pdf'],
            'application/msword': ['.doc'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
        },
        multiple: false,
        maxSize: 10 * 1024 * 1024, // 10MB
    });

    const handleUpload = async () => {
        if (!selectedFile) {
            setError('Please select a file to upload');
            return;
        }

        setUploading(true);
        setError('');

        try {
            // Upload file to Firebase Storage
            const uploadResult = await uploadDocument(
                selectedFile,
                patientId,
                documentType,
                setUploadProgress
            );

            if (!uploadResult.success) {
                throw new Error(uploadResult.error);
            }

            // Create document record in Firestore
            const documentRecord: Omit<PatientDocument, 'id' | 'uploadedAt'> = {
                patientId,
                fileName: uploadResult.fileName!,
                originalFileName: selectedFile.name,
                fileUrl: uploadResult.fileUrl!,
                fileSize: selectedFile.size,
                fileType: selectedFile.type,
                documentType,
                ...(description && description.trim() && {description: description.trim()}),
                isActive: true,
                tags: [],
                metadata: {},
            };

            const createResult = await documentOperations.createDocument(documentRecord);

            if (createResult.success) {
                onSuccess();
                handleClose();
            } else {
                throw new Error(createResult.error);
            }
        } catch (error: unknown) {
            logger.error('Upload error:', error);
            setError(errorMessage(error) || 'Upload failed');
        } finally {
            setUploading(false);
            setUploadProgress(null);
        }
    };

    const handleClose = () => {
        setSelectedFile(null);
        setDescription('');
        setError('');
        setUploadProgress(null);
        onClose();
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            title="Upload Document"
            icon={<div className="bg-primary-100 p-2 rounded-lg"><FileText className="h-6 w-6 text-primary-600"/></div>}
        >
                    <div className="p-6 space-y-6">
                        <ErrorAlert message={error} />

                        {/* Document Type Selection */}
                        <div>
                            <label className="block text-sm font-medium text-secondary-700 mb-2">
                                Document Type
                            </label>
                            <select
                                value={documentType}
                                onChange={(e) => onTypeChange(e.target.value as DocumentType)}
                                className="input w-full"
                                disabled={uploading}
                            >
                                {documentTypes.map((type) => (
                                    <option key={type.value} value={type.value}>
                                        {type.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* File Upload Area */}
                        <div>
                            <label className="block text-sm font-medium text-secondary-700 mb-2">
                                Select File
                            </label>
                            <div
                                {...getRootProps()}
                                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                                    isDragActive
                                        ? 'border-primary-500 bg-primary-50'
                                        : selectedFile
                                            ? 'border-green-500 bg-green-50'
                                            : 'border-secondary-300 hover:border-secondary-400'
                                }`}
                            >
                                <input {...getInputProps()} />
                                <Upload className="h-12 w-12 mx-auto mb-4 text-secondary-400"/>

                                {selectedFile ? (
                                    <div>
                                        <p className="text-lg font-medium text-green-700 mb-2">
                                            {selectedFile.name}
                                        </p>
                                        <p className="text-sm text-secondary-600">
                                            {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                                        </p>
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedFile(null);
                                            }}
                                            className="mt-2"
                                        >
                                            Remove File
                                        </Button>
                                    </div>
                                ) : (
                                    <div>
                                        <p className="text-lg font-medium text-secondary-700 mb-2">
                                            {isDragActive
                                                ? 'Drop the file here...'
                                                : 'Drag and drop a file here, or click to select'}
                                        </p>
                                        <p className="text-sm text-secondary-500">
                                            Supports: Images, PDF, Word documents (Max: 10MB)
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Description */}
                        <div>
                            <Input
                                label="Description (Optional)"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Brief description of this document..."
                                disabled={uploading}
                            />
                        </div>

                        {/* Upload Progress */}
                        {uploadProgress && (
                            <div className="space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span>Uploading...</span>
                                    <span>{Math.round(uploadProgress.progress)}%</span>
                                </div>
                                <div className="w-full bg-secondary-200 rounded-full h-2">
                                    <div
                                        className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                                        style={{width: `${uploadProgress.progress}%`}}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center justify-end space-x-3 pt-6 border-t border-secondary-200">
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={handleClose}
                                disabled={uploading}
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleUpload}
                                loading={uploading}
                                disabled={!selectedFile}
                            >
                                Upload Document
                            </Button>
                        </div>
                    </div>
        </Modal>
    );
};
