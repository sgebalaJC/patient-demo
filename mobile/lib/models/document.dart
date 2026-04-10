import 'package:cloud_firestore/cloud_firestore.dart';

enum DocumentType {
  driversLicense,
  insuranceCardFront,
  insuranceCardBack,
  medicalRecords,
  labResults,
  advanceDirective,
  prescription,
  other,
}

class PatientDocument {
  final String id;
  final String patientId;
  final String? doctorId;
  final String fileName;
  final String? originalFileName;
  final String fileUrl;
  final int? fileSize;
  final String? fileType;
  final DocumentType documentType;
  final String? description;
  final DateTime? uploadedAt;
  final bool isActive;

  PatientDocument({
    required this.id,
    required this.patientId,
    this.doctorId,
    required this.fileName,
    this.originalFileName,
    required this.fileUrl,
    this.fileSize,
    this.fileType,
    required this.documentType,
    this.description,
    this.uploadedAt,
    this.isActive = true,
  });

  factory PatientDocument.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    return PatientDocument(
      id: doc.id,
      patientId: data['patientId'] ?? '',
      doctorId: data['doctorId'],
      fileName: data['fileName'] ?? '',
      originalFileName: data['originalFileName'],
      fileUrl: data['fileUrl'] ?? '',
      fileSize: data['fileSize'],
      fileType: data['fileType'],
      documentType: _parseDocumentType(data['documentType']),
      description: data['description'],
      uploadedAt: _parseTimestamp(data['uploadedAt']),
      isActive: data['isActive'] ?? true,
    );
  }

  static DocumentType _parseDocumentType(String? type) {
    switch (type) {
      case 'drivers_license':
        return DocumentType.driversLicense;
      case 'insurance_card_front':
        return DocumentType.insuranceCardFront;
      case 'insurance_card_back':
        return DocumentType.insuranceCardBack;
      case 'medical_records':
        return DocumentType.medicalRecords;
      case 'lab_results':
        return DocumentType.labResults;
      case 'advance_directive':
        return DocumentType.advanceDirective;
      case 'prescription':
        return DocumentType.prescription;
      default:
        return DocumentType.other;
    }
  }

  static DateTime? _parseTimestamp(dynamic value) {
    if (value is Timestamp) return value.toDate();
    return null;
  }
}
