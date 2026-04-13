import 'dart:io';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:file_picker/file_picker.dart';
import '../../providers/auth_provider.dart';
import '../../services/firestore/documents_service.dart';
import '../../services/storage_service.dart';
import '../../models/document.dart';
import '../../config/colors.dart';

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

  @override
  Widget build(BuildContext context) {
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
          : _documents.isEmpty
              ? RefreshIndicator(
                  onRefresh: _loadDocuments,
                  child: ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    children: [
                      SizedBox(
                          height: MediaQuery.of(context).size.height * 0.3),
                      Icon(Icons.folder_outlined,
                          size: 48, color: Colors.grey.shade400),
                      const SizedBox(height: 16),
                      Text('No documents uploaded',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.grey.shade500)),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _loadDocuments,
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _documents.length,
                    itemBuilder: (context, index) {
                      final doc = _documents[index];
                      return _DocumentTile(document: doc);
                    },
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
        'fileType': platformFile.extension != null
            ? 'application/${platformFile.extension}'
            : 'application/octet-stream',
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

class _DocumentTile extends StatelessWidget {
  final PatientDocument document;
  const _DocumentTile({required this.document});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceCard,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: AppColors.purple.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(
              _getIcon(document.documentType),
              color: AppColors.purple,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  document.originalFileName ?? document.fileName,
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    color: AppColors.textDark,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  _formatDocType(document.documentType),
                  style: TextStyle(fontSize: 13, color: Colors.grey.shade500),
                ),
              ],
            ),
          ),
          Icon(Icons.chevron_right, color: Colors.grey.shade400),
        ],
      ),
    );
  }

  IconData _getIcon(DocumentType type) {
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
