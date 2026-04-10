import 'package:cloud_firestore/cloud_firestore.dart';

enum ThreadPriority { low, normal, high, urgent }

enum ThreadStatus { open, inProgress, resolved, closed }

class MessageThread {
  final String id;
  final String patientId;
  final String? patientName;
  final String subject;
  final String? lastMessage;
  final DateTime? lastMessageAt;
  final String? lastMessageSenderId;
  final bool unreadForPatient;
  final bool unreadForAdmin;
  final ThreadPriority priority;
  final ThreadStatus status;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  MessageThread({
    required this.id,
    required this.patientId,
    this.patientName,
    required this.subject,
    this.lastMessage,
    this.lastMessageAt,
    this.lastMessageSenderId,
    this.unreadForPatient = false,
    this.unreadForAdmin = false,
    this.priority = ThreadPriority.normal,
    this.status = ThreadStatus.open,
    this.createdAt,
    this.updatedAt,
  });

  factory MessageThread.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    return MessageThread(
      id: doc.id,
      patientId: data['patientId'] ?? '',
      patientName: data['patientName'],
      subject: data['subject'] ?? '',
      lastMessage: data['lastMessage'],
      lastMessageAt: _parseTimestamp(data['lastMessageAt']),
      lastMessageSenderId: data['lastMessageSenderId'],
      unreadForPatient: data['unreadForPatient'] ?? false,
      unreadForAdmin: data['unreadForAdmin'] ?? false,
      priority: _parsePriority(data['priority']),
      status: _parseStatus(data['status']),
      createdAt: _parseTimestamp(data['createdAt']),
      updatedAt: _parseTimestamp(data['updatedAt']),
    );
  }

  static ThreadPriority _parsePriority(String? priority) {
    switch (priority) {
      case 'low':
        return ThreadPriority.low;
      case 'high':
        return ThreadPriority.high;
      case 'urgent':
        return ThreadPriority.urgent;
      default:
        return ThreadPriority.normal;
    }
  }

  static ThreadStatus _parseStatus(String? status) {
    switch (status) {
      case 'in_progress':
        return ThreadStatus.inProgress;
      case 'resolved':
        return ThreadStatus.resolved;
      case 'closed':
        return ThreadStatus.closed;
      default:
        return ThreadStatus.open;
    }
  }

  static DateTime? _parseTimestamp(dynamic value) {
    if (value is Timestamp) return value.toDate();
    return null;
  }
}

class ThreadMessage {
  final String id;
  final String threadId;
  final String senderId;
  final String? senderName;
  final String? senderRole;
  final String content;
  final List<Map<String, dynamic>> attachments;
  final DateTime? createdAt;
  final bool isEdited;

  ThreadMessage({
    required this.id,
    required this.threadId,
    required this.senderId,
    this.senderName,
    this.senderRole,
    required this.content,
    this.attachments = const [],
    this.createdAt,
    this.isEdited = false,
  });

  factory ThreadMessage.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    return ThreadMessage(
      id: doc.id,
      threadId: data['threadId'] ?? '',
      senderId: data['senderId'] ?? '',
      senderName: data['senderName'],
      senderRole: data['senderRole'],
      content: data['content'] ?? '',
      attachments: List<Map<String, dynamic>>.from(data['attachments'] ?? []),
      createdAt: _parseTimestamp(data['createdAt']),
      isEdited: data['isEdited'] ?? false,
    );
  }

  static DateTime? _parseTimestamp(dynamic value) {
    if (value is Timestamp) return value.toDate();
    return null;
  }
}
