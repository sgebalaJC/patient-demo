import 'dart:io';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:file_picker/file_picker.dart';
import 'package:path/path.dart' as p;
import '../../providers/auth_provider.dart';
import '../../services/firestore/documents_service.dart';
import '../../services/storage_service.dart';
import '../../models/document.dart';
import '../../config/colors.dart';
import 'document_preview_screen.dart';

class DocumentsScreen extends StatefulWidget {
  const DocumentsScreen({super.key});

  @override
  State<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends State<DocumentsScreen> {
  final _service = DocumentsService();
  final _storageService = StorageService();
  List<PatientDocument> _documents = [];
  bool _loading = true;
  bool _uploading = false;
  double _uploadProgress = 0;

  @override
  void initState() {
    super.initState();
    _loadDocuments();
  }

  Future<void> _loadDocuments() async {
    final uid = context.read<AuthProvider>().firebaseUser?.uid;
    if (uid == null) return;

    setState(() => _loading = true);
    try {
      final docs = await _service.getPatientDocuments(uid);
      if (mounted) {
        setState(() {
          _documents = docs;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Map<DocumentType, List<PatientDocument>> _grouped() {
    final result = <DocumentType, List<PatientDocument>>{};
    for (final doc in _documents) {
      result.putIfAbsent(doc.documentType, () => []).add(doc);
    }
    return result;
  }

  @override
  Widget build(BuildContext context) {
    final grouped = _grouped();

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Documents'),
        backgroundColor: AppColors.background,
        foregroundColor: AppColors.textDark,
        elevation: 0,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadDocuments,
              child: ListView(
                padding: const EdgeInsets.all(16),
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  if (_documents.isEmpty)
                    Padding(
                      padding: EdgeInsets.only(
                          top: MediaQuery.of(context).size.height * 0.2),
                      child: Column(
                        children: [
                          Icon(Icons.folder_outlined,
                              size: 48, color: Colors.grey.shade400),
                          const SizedBox(height: 16),
                          Text('No documents uploaded',
                              style: TextStyle(color: Colors.grey.shade500)),
                        ],
                      ),
                    )
                  else
                    ...DocumentType.values.map((type) {
                      final docs = grouped[type] ?? const <PatientDocument>[];
                      return _DocumentGroupCard(
                        type: type,
                        documents: docs,
                        onTapDocument: _openPreview,
                        onDeleteDocument: _confirmDelete,
                      );
                    }),
                ],
              ),
            ),
      floatingActionButton: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_uploading)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: SizedBox(
                width: 56,
                height: 56,
                child: CircularProgressIndicator(
                  value: _uploadProgress > 0 ? _uploadProgress : null,
                  strokeWidth: 3,
                  color: AppColors.primary,
                ),
              ),
            ),
          FloatingActionButton(
            backgroundColor: _uploading ? Colors.grey : AppColors.primary,
            onPressed: _uploading ? null : _showDocumentTypePicker,
            child: const Icon(Icons.upload_file, color: Colors.white),
          ),
        ],
      ),
    );
  }

  void _openPreview(PatientDocument doc) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => DocumentPreviewScreen(document: doc),
      ),
    );
  }

  Future<void> _confirmDelete(PatientDocument doc) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete document'),
        content: Text(
          'Delete "${doc.originalFileName ?? doc.fileName}"? This cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;
    try {
      await _service.deleteDocument(doc.id);
      await _loadDocuments();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Delete failed: $e')),
        );
      }
    }
  }

  void _showDocumentTypePicker() {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text(
                'Select document type',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
              ),
            ),
            ...DocumentType.values.map((type) => ListTile(
                  leading: Icon(_getDocTypeIcon(type), color: AppColors.purple),
                  title: Text(_formatDocType(type)),
                  onTap: () {
                    Navigator.pop(ctx);
                    _pickAndUpload(type);
                  },
                )),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  Future<void> _pickAndUpload(DocumentType type) async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['jpg', 'jpeg', 'png', 'heic', 'pdf', 'doc', 'docx'],
    );
    if (result == null || result.files.isEmpty) return;

    final platformFile = result.files.first;
    if (platformFile.path == null) return;
    final file = File(platformFile.path!);

    final validationError = _storageService.validateDocumentFile(file);
    if (validationError != null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(validationError)),
        );
      }
      return;
    }

    final uid = context.read<AuthProvider>().firebaseUser?.uid;
    if (uid == null) return;

    setState(() {
      _uploading = true;
      _uploadProgress = 0;
    });

    try {
      final downloadUrl = await _storageService.uploadDocument(
        file: file,
        patientId: uid,
        documentType: _toStorageKey(type),
        onProgress: (progress) {
          if (mounted) setState(() => _uploadProgress = progress);
        },
      );

      await _service.createDocument({
        'patientId': uid,
        'fileName': platformFile.name,
        'originalFileName': platformFile.name,
        'fileUrl': downloadUrl,
        'fileSize': platformFile.size,
        'fileType': _mimeFromName(platformFile.name),
        'documentType': _toStorageKey(type),
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Document uploaded successfully')),
        );
      }
      await _loadDocuments();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Upload failed: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  String _toStorageKey(DocumentType type) {
    switch (type) {
      case DocumentType.driversLicense:
        return 'drivers_license';
      case DocumentType.insuranceCardFront:
        return 'insurance_card_front';
      case DocumentType.insuranceCardBack:
        return 'insurance_card_back';
      case DocumentType.medicalRecords:
        return 'medical_records';
      case DocumentType.labResults:
        return 'lab_results';
      case DocumentType.advanceDirective:
        return 'advance_directive';
      case DocumentType.prescription:
        return 'prescription';
      case DocumentType.other:
        return 'other';
    }
  }

  IconData _getDocTypeIcon(DocumentType type) {
    switch (type) {
      case DocumentType.driversLicense:
        return Icons.badge_outlined;
      case DocumentType.insuranceCardFront:
      case DocumentType.insuranceCardBack:
        return Icons.credit_card;
      case DocumentType.medicalRecords:
        return Icons.medical_information_outlined;
      case DocumentType.labResults:
        return Icons.science_outlined;
      case DocumentType.prescription:
        return Icons.medication_outlined;
      default:
        return Icons.description_outlined;
    }
  }

  String _formatDocType(DocumentType type) {
    return type.name
        .replaceAllMapped(RegExp(r'[A-Z]'), (m) => ' ${m.group(0)}')
        .trim();
  }
}

String _mimeFromName(String name) {
  final ext = p.extension(name).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.heic':
      return 'image/heic';
    case '.pdf':
      return 'application/pdf';
    case '.doc':
      return 'application/msword';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    default:
      return 'application/octet-stream';
  }
}

String _formatFileSize(int? bytes) {
  if (bytes == null || bytes <= 0) return '—';
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
  return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
}

String _formatDate(DateTime? dt) {
  if (dt == null) return '—';
  return '${dt.month}/${dt.day}/${dt.year}';
}

String _formatDocTypeLabel(DocumentType type) {
  switch (type) {
    case DocumentType.driversLicense:
      return "Driver's License";
    case DocumentType.insuranceCardFront:
      return 'Insurance Card (Front)';
    case DocumentType.insuranceCardBack:
      return 'Insurance Card (Back)';
    case DocumentType.medicalRecords:
      return 'Medical Records';
    case DocumentType.labResults:
      return 'Lab Results';
    case DocumentType.advanceDirective:
      return 'Advance Directive';
    case DocumentType.prescription:
      return 'Prescriptions';
    case DocumentType.other:
      return 'Other Documents';
  }
}

IconData _docTypeIcon(DocumentType type) {
  switch (type) {
    case DocumentType.driversLicense:
      return Icons.badge_outlined;
    case DocumentType.insuranceCardFront:
    case DocumentType.insuranceCardBack:
      return Icons.credit_card;
    case DocumentType.medicalRecords:
      return Icons.medical_information_outlined;
    case DocumentType.labResults:
      return Icons.science_outlined;
    case DocumentType.prescription:
      return Icons.medication_outlined;
    default:
      return Icons.description_outlined;
  }
}

IconData _fileIconForType(String? fileType) {
  final t = fileType ?? '';
  if (t.startsWith('image/')) return Icons.image_outlined;
  if (t == 'application/pdf') return Icons.picture_as_pdf_outlined;
  if (t.contains('word')) return Icons.description_outlined;
  return Icons.insert_drive_file_outlined;
}

class _DocumentGroupCard extends StatelessWidget {
  final DocumentType type;
  final List<PatientDocument> documents;
  final void Function(PatientDocument) onTapDocument;
  final void Function(PatientDocument) onDeleteDocument;

  const _DocumentGroupCard({
    required this.type,
    required this.documents,
    required this.onTapDocument,
    required this.onDeleteDocument,
  });

  @override
  Widget build(BuildContext context) {
    final count = documents.length;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: EdgeInsets.all(count == 0 ? 12 : 14),
      decoration: BoxDecoration(
        color: AppColors.surfaceCard,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: AppColors.purple.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(_docTypeIcon(type), color: AppColors.purple),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  _formatDocTypeLabel(type),
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    color: AppColors.textDark,
                  ),
                ),
              ),
              Text(
                '$count doc${count == 1 ? '' : 's'}',
                style: TextStyle(fontSize: 12, color: Colors.grey.shade500),
              ),
            ],
          ),
          if (count > 0) ...[
            const SizedBox(height: 10),
            ...documents.map((doc) => _DocumentRow(
                  document: doc,
                  onTap: () => onTapDocument(doc),
                  onDelete: () => onDeleteDocument(doc),
                )),
          ],
        ],
      ),
    );
  }
}

class _DocumentRow extends StatelessWidget {
  final PatientDocument document;
  final VoidCallback onTap;
  final VoidCallback onDelete;

  const _DocumentRow({
    required this.document,
    required this.onTap,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final meta = '${_formatFileSize(document.fileSize)} · ${_formatDate(document.uploadedAt)}';

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        margin: const EdgeInsets.only(top: 6),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        decoration: BoxDecoration(
          color: AppColors.background,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          children: [
            Icon(_fileIconForType(document.fileType),
                size: 20, color: AppColors.primary),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    document.originalFileName ?? document.fileName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w500,
                      color: AppColors.textDark,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    meta,
                    style:
                        TextStyle(fontSize: 11.5, color: AppColors.textMedium),
                  ),
                ],
              ),
            ),
            IconButton(
              onPressed: onDelete,
              icon: Icon(Icons.delete_outline,
                  size: 20, color: Colors.red.shade400),
              tooltip: 'Delete',
              visualDensity: VisualDensity.compact,
            ),
          ],
        ),
      ),
    );
  }
}
