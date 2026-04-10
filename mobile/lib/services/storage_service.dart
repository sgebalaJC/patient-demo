import 'dart:io';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:path/path.dart' as path;

class StorageService {
  final FirebaseStorage _storage = FirebaseStorage.instance;

  static const int maxDocumentSize = 10 * 1024 * 1024; // 10MB
  static const int maxAttachmentSize = 25 * 1024 * 1024; // 25MB

  static const List<String> allowedDocumentTypes = [
    'image/jpeg',
    'image/png',
    'image/heic',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];

  /// Upload a patient document
  Future<String> uploadDocument({
    required File file,
    required String patientId,
    required String documentType,
    void Function(double)? onProgress,
  }) async {
    final fileName =
        '${DateTime.now().millisecondsSinceEpoch}_${path.basename(file.path)}';
    final storagePath =
        'patients/$patientId/documents/$documentType/$fileName';

    final ref = _storage.ref(storagePath);
    final uploadTask = ref.putFile(file);

    if (onProgress != null) {
      uploadTask.snapshotEvents.listen((event) {
        final progress = event.bytesTransferred / event.totalBytes;
        onProgress(progress);
      });
    }

    await uploadTask;
    return await ref.getDownloadURL();
  }

  /// Upload a message attachment
  Future<String> uploadMessageAttachment({
    required File file,
    required String threadId,
    void Function(double)? onProgress,
  }) async {
    final fileName =
        '${DateTime.now().millisecondsSinceEpoch}_${path.basename(file.path)}';
    final storagePath = 'messages/$threadId/attachments/$fileName';

    final ref = _storage.ref(storagePath);
    final uploadTask = ref.putFile(file);

    if (onProgress != null) {
      uploadTask.snapshotEvents.listen((event) {
        final progress = event.bytesTransferred / event.totalBytes;
        onProgress(progress);
      });
    }

    await uploadTask;
    return await ref.getDownloadURL();
  }

  /// Delete a file by storage path
  Future<void> deleteFile(String storagePath) async {
    await _storage.ref(storagePath).delete();
  }

  /// Validate document file
  String? validateDocumentFile(File file) {
    final size = file.lengthSync();
    if (size > maxDocumentSize) {
      return 'File size exceeds 10MB limit';
    }
    return null;
  }

  /// Validate message attachment
  String? validateAttachment(File file) {
    final size = file.lengthSync();
    if (size > maxAttachmentSize) {
      return 'File size exceeds 25MB limit';
    }
    return null;
  }
}
