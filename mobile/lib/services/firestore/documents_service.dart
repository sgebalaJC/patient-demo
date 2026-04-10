import 'package:cloud_firestore/cloud_firestore.dart';
import '../../models/document.dart';

class DocumentsService {
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  CollectionReference get _collection => _db.collection('patient-documents');

  /// Get patient's active documents
  Future<List<PatientDocument>> getPatientDocuments(String patientId) async {
    final snapshot = await _collection
        .where('patientId', isEqualTo: patientId)
        .where('isActive', isEqualTo: true)
        .orderBy('uploadedAt', descending: true)
        .get();

    return snapshot.docs
        .map((doc) => PatientDocument.fromFirestore(doc))
        .toList();
  }

  /// Get documents by type
  Future<List<PatientDocument>> getDocumentsByType(
    String patientId,
    String documentType,
  ) async {
    final snapshot = await _collection
        .where('patientId', isEqualTo: patientId)
        .where('documentType', isEqualTo: documentType)
        .where('isActive', isEqualTo: true)
        .get();

    return snapshot.docs
        .map((doc) => PatientDocument.fromFirestore(doc))
        .toList();
  }

  /// Create document record (after file upload)
  Future<String> createDocument(Map<String, dynamic> data) async {
    data['isActive'] = true;
    data['uploadedAt'] = FieldValue.serverTimestamp();
    final doc = await _collection.add(data);
    return doc.id;
  }

  /// Soft delete a document
  Future<void> deleteDocument(String documentId) async {
    await _collection.doc(documentId).update({'isActive': false});
  }
}
