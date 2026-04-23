import 'package:cloud_firestore/cloud_firestore.dart';
import '../../models/message_thread.dart';
import '../../widgets/paginated_list.dart';

class MessagesService {
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  CollectionReference get _threads => _db.collection('message-threads');

  static const int pageSize = 15;

  /// Get patient's message threads with cursor-based pagination
  Future<PaginatedResult<MessageThread>> getPatientThreadsPage(
    String patientId, {
    DocumentSnapshot? cursor,
    int limit = pageSize,
    String filter = 'all',
  }) async {
    Query query = _threads
        .where('isActive', isEqualTo: true)
        .where('patientId', isEqualTo: patientId);

    if (filter == 'unread') {
      query = query.where('unreadForPatient', isEqualTo: true);
    } else if (filter == 'priority') {
      query = query.where('priority', whereIn: ['high', 'urgent']);
    }

    query = query.orderBy('updatedAt', descending: true).limit(limit + 1);

    if (cursor != null) {
      query = query.startAfterDocument(cursor);
    }

    final snapshot = await query.get();
    final hasMore = snapshot.docs.length > limit;
    final docs = hasMore ? snapshot.docs.sublist(0, limit) : snapshot.docs;

    return PaginatedResult(
      items: docs.map((doc) => MessageThread.fromFirestore(doc)).toList(),
      lastDoc: docs.isNotEmpty ? docs.last : null,
      hasMore: hasMore,
    );
  }

  /// Get patient's message threads (non-paginated, for backward compat)
  Future<List<MessageThread>> getPatientThreads(
    String patientId, {
    int limit = 20,
    String filter = 'all',
  }) async {
    Query query = _threads
        .where('isActive', isEqualTo: true)
        .where('patientId', isEqualTo: patientId);

    if (filter == 'unread') {
      query = query.where('unreadForPatient', isEqualTo: true);
    } else if (filter == 'priority') {
      query = query.where('priority', whereIn: ['high', 'urgent']);
    }

    final snapshot = await query
        .orderBy('updatedAt', descending: true)
        .limit(limit)
        .get();

    return snapshot.docs.map((doc) => MessageThread.fromFirestore(doc)).toList();
  }

  /// Listen to patient threads in real-time
  Stream<List<MessageThread>> patientThreadsStream(String patientId) {
    return _threads
        .where('isActive', isEqualTo: true)
        .where('patientId', isEqualTo: patientId)
        .orderBy('updatedAt', descending: true)
        .limit(20)
        .snapshots()
        .map((snapshot) =>
            snapshot.docs.map((doc) => MessageThread.fromFirestore(doc)).toList());
  }

  /// Get a single thread by ID
  Future<MessageThread?> getThread(String threadId) async {
    final doc = await _threads.doc(threadId).get();
    if (!doc.exists) return null;
    return MessageThread.fromFirestore(doc);
  }

  /// Get messages for a thread
  Future<List<ThreadMessage>> getThreadMessages(
    String threadId, {
    int limit = 50,
  }) async {
    final snapshot = await _db
        .collection('thread-messages')
        .where('threadId', isEqualTo: threadId)
        .orderBy('createdAt', descending: false)
        .limit(limit)
        .get();

    return snapshot.docs.map((doc) => ThreadMessage.fromFirestore(doc)).toList();
  }

  /// Listen to messages in real-time
  Stream<List<ThreadMessage>> threadMessagesStream(String threadId) {
    return _db
        .collection('thread-messages')
        .where('threadId', isEqualTo: threadId)
        .orderBy('createdAt', descending: false)
        .snapshots()
        .map((snapshot) =>
            snapshot.docs.map((doc) => ThreadMessage.fromFirestore(doc)).toList());
  }

  /// Create a thread shell with no messages yet. Returns the real threadId so
  /// attachments can be uploaded under `messages/{threadId}/attachments/*`
  /// (which is what storage.rules requires — the rule calls `firestore.get`
  /// on `message-threads/{threadId}` and checks `patientId`). Caller is
  /// expected to follow up with [sendMessage] for the first message so the
  /// thread's lastMessage / unreadForAdmin flags update in one step.
  Future<String> createEmptyThread({
    required String patientId,
    required String patientName,
    required String subject,
    String priority = 'normal',
  }) async {
    final ref = await _threads.add({
      'patientId': patientId,
      'patientName': patientName,
      'subject': subject,
      'lastMessage': '',
      'lastMessageAt': FieldValue.serverTimestamp(),
      'lastMessageSenderId': patientId,
      'isActive': true,
      'unreadForPatient': false,
      'unreadForAdmin': false,
      'priority': priority,
      'status': 'open',
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
    return ref.id;
  }

  /// Best-effort cleanup for an empty thread when the follow-up upload or
  /// first-message send fails. Swallows errors — worst case the user sees
  /// an empty thread they can retry from.
  Future<void> deleteThread(String threadId) async {
    try {
      await _threads.doc(threadId).delete();
    } catch (_) {}
  }

  /// Send a message in a thread
  Future<void> sendMessage({
    required String threadId,
    required String senderId,
    required String senderName,
    required String content,
    List<Map<String, dynamic>>? attachments,
  }) async {
    final batch = _db.batch();

    // Add message
    final msgRef = _db.collection('thread-messages').doc();
    batch.set(msgRef, {
      'threadId': threadId,
      'senderId': senderId,
      'senderName': senderName,
      'senderRole': 'patient',
      'content': content,
      'attachments': attachments ?? [],
      'createdAt': FieldValue.serverTimestamp(),
      'readBy': {senderId: FieldValue.serverTimestamp()},
      'isEdited': false,
    });

    // Update thread
    batch.update(_threads.doc(threadId), {
      'lastMessage': content,
      'lastMessageAt': FieldValue.serverTimestamp(),
      'lastMessageSenderId': senderId,
      'unreadForAdmin': true,
      'unreadForPatient': false,
      'updatedAt': FieldValue.serverTimestamp(),
    });

    await batch.commit();
  }

  /// Mark thread as read for patient
  Future<void> markThreadAsRead(String threadId) async {
    await _threads.doc(threadId).update({
      'unreadForPatient': false,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }
}
