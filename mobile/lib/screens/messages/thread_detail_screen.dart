import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:file_picker/file_picker.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path/path.dart' as p;
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import '../../providers/auth_provider.dart';
import '../../services/firestore/messages_service.dart';
import '../../services/firestore/notification_helper.dart';
import '../../services/storage_service.dart';
import '../../models/message_thread.dart';
import '../../config/constants.dart';
import '../../config/colors.dart';
import '../../utils/date_formatting.dart';

class ThreadDetailScreen extends StatefulWidget {
  final MessageThread thread;

  const ThreadDetailScreen({super.key, required this.thread});

  @override
  State<ThreadDetailScreen> createState() => _ThreadDetailScreenState();
}

class _ThreadDetailScreenState extends State<ThreadDetailScreen> {
  final _service = MessagesService();
  final _storageService = StorageService();
  final _messageController = TextEditingController();
  final _scrollController = ScrollController();

  List<ThreadMessage> _messages = [];
  bool _loading = true;
  bool _sending = false;
  StreamSubscription<List<ThreadMessage>>? _messagesSubscription;

  // Attachments
  final List<File> _selectedFiles = [];
  final Map<String, double> _uploadProgress = {};

  @override
  void initState() {
    super.initState();
    _listenToMessages();
    _service.markThreadAsRead(widget.thread.id);
  }

  @override
  void dispose() {
    _messagesSubscription?.cancel();
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _listenToMessages() {
    setState(() => _loading = true);
    _messagesSubscription = _service.threadMessagesStream(widget.thread.id).listen(
      (messages) {
        if (mounted) {
          setState(() {
            _messages = messages;
            _loading = false;
          });
          _scrollToBottom();
        }
      },
      onError: (e) {
        if (mounted) setState(() => _loading = false);
      },
    );
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _pickFiles() async {
    final result = await FilePicker.platform.pickFiles(
      allowMultiple: true,
      type: FileType.custom,
      allowedExtensions: [
        'jpg', 'jpeg', 'png', 'heic', 'gif',
        'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
        'txt', 'csv',
      ],
    );
    if (result == null) return;

    for (final pf in result.files) {
      if (pf.path == null) continue;
      final file = File(pf.path!);
      final error = _storageService.validateAttachment(file);
      if (error != null) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('${pf.name}: $error')),
          );
        }
        continue;
      }
      setState(() => _selectedFiles.add(file));
    }
  }

  void _removeFile(int index) {
    setState(() => _selectedFiles.removeAt(index));
  }

  Future<void> _sendMessage() async {
    final text = _messageController.text.trim();
    if (text.isEmpty && _selectedFiles.isEmpty) return;

    final auth = context.read<AuthProvider>();
    final uid = auth.firebaseUser?.uid;
    final profile = auth.userProfile;
    if (uid == null || profile == null) return;

    setState(() => _sending = true);

    try {
      // Upload attachments
      final attachments = <Map<String, dynamic>>[];
      for (final file in _selectedFiles) {
        final key = p.basename(file.path);
        final url = await _storageService.uploadMessageAttachment(
          file: file,
          threadId: widget.thread.id,
          onProgress: (progress) {
            if (mounted) {
              setState(() => _uploadProgress[key] = progress);
            }
          },
        );
        attachments.add({
          'id': '${DateTime.now().millisecondsSinceEpoch}_$key',
          'name': key,
          'url': url,
          'type': _mimeType(file.path),
          'size': file.lengthSync(),
        });
      }

      final content = text.isNotEmpty
          ? text
          : attachments.isNotEmpty
              ? '[Attachment]'
              : text;

      await _service.sendMessage(
        threadId: widget.thread.id,
        senderId: uid,
        senderName: profile.fullName,
        content: content,
        attachments: attachments.isNotEmpty ? attachments : null,
      );

      // Notify admins
      final preview = text.isNotEmpty
          ? (text.length > 60 ? '${text.substring(0, 60)}...' : text)
          : '[Attachment]';
      await NotificationHelper.notifyAdmins(
        type: 'new_message',
        title: 'New Message from ${profile.fullName}',
        message: 'Re: ${widget.thread.subject} — "$preview"',
        patientId: uid,
        extraMeta: {'threadId': widget.thread.id},
      );

      _messageController.clear();
      setState(() {
        _selectedFiles.clear();
        _uploadProgress.clear();
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to send message')),
        );
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  String _mimeType(String path) {
    final ext = p.extension(path).toLowerCase();
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
      case '.xls':
        return 'application/vnd.ms-excel';
      case '.xlsx':
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      case '.txt':
        return 'text/plain';
      case '.csv':
        return 'text/csv';
      default:
        return 'application/octet-stream';
    }
  }

  @override
  Widget build(BuildContext context) {
    final uid = context.read<AuthProvider>().firebaseUser?.uid ?? '';

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(
          widget.thread.subject,
          style: TextStyle(fontSize: 16),
        ),
        backgroundColor: AppColors.background,
        foregroundColor: AppColors.textDark,
        elevation: 0,
      ),
      body: Column(
        children: [
          // Messages list
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _messages.isEmpty
                    ? const Center(child: Text('No messages'))
                    : ListView.builder(
                        controller: _scrollController,
                        padding: const EdgeInsets.all(16),
                        itemCount: _messages.length,
                        itemBuilder: (context, index) {
                          final msg = _messages[index];
                          final isMe = msg.senderId == uid;
                          return _MessageBubble(
                            message: msg,
                            isMe: isMe,
                          );
                        },
                      ),
          ),

          // Attachment preview strip
          if (_selectedFiles.isNotEmpty)
            Container(
              color: AppColors.surfaceCard,
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
              child: SizedBox(
                height: 64,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: _selectedFiles.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 8),
                  itemBuilder: (_, i) {
                    final file = _selectedFiles[i];
                    final name = p.basename(file.path);
                    final progress = _uploadProgress[name];
                    return Container(
                      width: 140,
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: AppColors.background,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: AppColors.divider),
                      ),
                      child: Row(
                        children: [
                          Icon(_fileIcon(file.path),
                              size: 18, color: AppColors.primary),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                      fontSize: 11, color: AppColors.textDark),
                                ),
                                Text(
                                  _formatSize(file.lengthSync()),
                                  style: TextStyle(
                                      fontSize: 10, color: AppColors.textMedium),
                                ),
                                if (progress != null && progress < 1.0)
                                  Padding(
                                    padding: const EdgeInsets.only(top: 2),
                                    child: LinearProgressIndicator(
                                      value: progress,
                                      minHeight: 2,
                                      color: AppColors.primary,
                                      backgroundColor: AppColors.divider,
                                    ),
                                  ),
                              ],
                            ),
                          ),
                          if (!_sending)
                            GestureDetector(
                              onTap: () => _removeFile(i),
                              child: Icon(Icons.close,
                                  size: 16, color: Colors.grey.shade500),
                            ),
                        ],
                      ),
                    );
                  },
                ),
              ),
            ),

          // Input bar
          Container(
            padding: EdgeInsets.fromLTRB(
              8,
              8,
              8,
              8 + MediaQuery.of(context).viewPadding.bottom,
            ),
            decoration: BoxDecoration(
              color: AppColors.surfaceCard,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.05),
                  blurRadius: 10,
                  offset: const Offset(0, -2),
                ),
              ],
            ),
            child: Row(
              children: [
                IconButton(
                  onPressed: _sending ? null : _pickFiles,
                  icon: Icon(Icons.attach_file_rounded,
                      color: Colors.grey.shade600),
                ),
                Expanded(
                  child: TextField(
                    controller: _messageController,
                    maxLength: FieldLimits.messageContentMax,
                    maxLines: 4,
                    minLines: 1,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: InputDecoration(
                      hintText: 'Type a message...',
                      counterText: '',
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 10),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(24),
                        borderSide: BorderSide(color: Colors.grey.shade300),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(24),
                        borderSide: BorderSide(color: Colors.grey.shade300),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 4),
                IconButton(
                  onPressed: _sending ? null : _sendMessage,
                  icon: _sending
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Icon(Icons.send_rounded,
                          color: AppColors.primary),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  IconData _fileIcon(String path) {
    final ext = p.extension(path).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.gif', '.heic'].contains(ext)) {
      return Icons.image_outlined;
    }
    if (ext == '.pdf') return Icons.picture_as_pdf_outlined;
    if (['.doc', '.docx'].contains(ext)) return Icons.description_outlined;
    if (['.xls', '.xlsx'].contains(ext)) return Icons.table_chart_outlined;
    return Icons.insert_drive_file_outlined;
  }

  String _formatSize(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}

class _MessageBubble extends StatelessWidget {
  final ThreadMessage message;
  final bool isMe;

  const _MessageBubble({required this.message, required this.isMe});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        mainAxisAlignment:
            isMe ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (!isMe) ...[
            CircleAvatar(
              radius: 14,
              backgroundColor: Colors.grey.shade200,
              child: Text(
                (message.senderName ?? '?')[0].toUpperCase(),
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: Colors.grey.shade700,
                ),
              ),
            ),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: isMe
                    ? AppColors.primary
                    : AppColors.surfaceCard,
                borderRadius: BorderRadius.only(
                  topLeft: const Radius.circular(16),
                  topRight: const Radius.circular(16),
                  bottomLeft: Radius.circular(isMe ? 16 : 4),
                  bottomRight: Radius.circular(isMe ? 4 : 16),
                ),
                boxShadow: isMe
                    ? null
                    : [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.05),
                          blurRadius: 4,
                          offset: const Offset(0, 1),
                        ),
                      ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (!isMe && message.senderName != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Text(
                        message.senderName!,
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: Colors.grey.shade600,
                        ),
                      ),
                    ),
                  if (message.content.isNotEmpty &&
                      message.content != '[Attachment]')
                    Text(
                      message.content,
                      style: TextStyle(
                        color: isMe ? Colors.white : AppColors.textDark,
                        fontSize: 14,
                      ),
                    ),
                  // Attachments
                  if (message.attachments.isNotEmpty) ...[
                    if (message.content.isNotEmpty &&
                        message.content != '[Attachment]')
                      const SizedBox(height: 8),
                    ...message.attachments.map((att) => _AttachmentChip(
                          attachment: att,
                          isMe: isMe,
                        )),
                  ],
                  if (message.createdAt != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        formatTime(message.createdAt!),
                        style: TextStyle(
                          fontSize: 10,
                          color: isMe
                              ? Colors.white.withValues(alpha: 0.7)
                              : Colors.grey.shade400,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          if (isMe) const SizedBox(width: 8),
        ],
      ),
    );
  }
}

class _AttachmentChip extends StatelessWidget {
  final Map<String, dynamic> attachment;
  final bool isMe;

  const _AttachmentChip({required this.attachment, required this.isMe});

  @override
  Widget build(BuildContext context) {
    final name = attachment['name'] as String? ?? 'File';
    final size = attachment['size'] as int? ?? 0;
    final type = attachment['type'] as String? ?? '';
    final url = attachment['url'] as String? ?? '';

    return GestureDetector(
      onTap: () => _openAttachment(context, url, name),
      child: Container(
        margin: const EdgeInsets.only(bottom: 4),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: isMe
              ? Colors.white.withValues(alpha: 0.15)
              : AppColors.background,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              _iconForType(type),
              size: 16,
              color: isMe ? Colors.white : AppColors.primary,
            ),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 12,
                  color: isMe ? Colors.white : AppColors.textDark,
                ),
              ),
            ),
            const SizedBox(width: 6),
            Text(
              _formatSize(size),
              style: TextStyle(
                fontSize: 10,
                color: isMe
                    ? Colors.white.withValues(alpha: 0.7)
                    : AppColors.textMedium,
              ),
            ),
            const SizedBox(width: 6),
            Icon(
              Icons.download_outlined,
              size: 14,
              color: isMe ? Colors.white : AppColors.textMedium,
            ),
          ],
        ),
      ),
    );
  }

  IconData _iconForType(String type) {
    if (type.startsWith('image/')) return Icons.image_outlined;
    if (type.contains('pdf')) return Icons.picture_as_pdf_outlined;
    if (type.contains('word') || type.contains('document')) {
      return Icons.description_outlined;
    }
    if (type.contains('sheet') || type.contains('excel')) {
      return Icons.table_chart_outlined;
    }
    return Icons.insert_drive_file_outlined;
  }

  String _formatSize(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  Future<void> _openAttachment(
      BuildContext context, String url, String name) async {
    if (url.isEmpty) return;
    try {
      final dir = await getTemporaryDirectory();
      final filePath = '${dir.path}/$name';
      final file = File(filePath);

      if (!file.existsSync()) {
        // Download to temp
        final response = await http.get(Uri.parse(url));
        await file.writeAsBytes(response.bodyBytes);
      }

      await OpenFilex.open(filePath);
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not open file')),
        );
      }
    }
  }
}
