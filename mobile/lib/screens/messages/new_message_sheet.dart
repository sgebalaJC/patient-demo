import 'dart:io';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:file_picker/file_picker.dart';
import 'package:path/path.dart' as p;
import '../../providers/auth_provider.dart';
import '../../services/firestore/messages_service.dart';
import '../../services/firestore/notification_helper.dart';
import '../../services/storage_service.dart';
import '../../config/constants.dart';
import '../../config/colors.dart';
import '../../widgets/bottom_sheet_header.dart';

class NewMessageSheet extends StatefulWidget {
  final VoidCallback? onSent;

  const NewMessageSheet({super.key, this.onSent});

  static Future<void> show(BuildContext context, {VoidCallback? onSent}) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => NewMessageSheet(onSent: onSent),
    );
  }

  @override
  State<NewMessageSheet> createState() => _NewMessageSheetState();
}

class _NewMessageSheetState extends State<NewMessageSheet> {
  final _subjectController = TextEditingController();
  final _messageController = TextEditingController();
  final _service = MessagesService();
  final _storageService = StorageService();

  String _priority = 'normal';
  bool _submitting = false;
  String? _error;

  final List<File> _selectedFiles = [];

  @override
  void dispose() {
    _subjectController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  String? _validateSubject(String value) {
    if (value.trim().length < FieldLimits.messageSubjectMin) {
      return 'Subject must be at least ${FieldLimits.messageSubjectMin} characters';
    }
    return null;
  }

  String? _validateMessage(String value) {
    if (value.trim().length < FieldLimits.messageContentMin &&
        _selectedFiles.isEmpty) {
      return 'Message must be at least ${FieldLimits.messageContentMin} characters';
    }
    return null;
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

  Future<void> _submit() async {
    final subjectError = _validateSubject(_subjectController.text);
    final messageError = _validateMessage(_messageController.text);
    if (subjectError != null || messageError != null) {
      setState(() => _error = subjectError ?? messageError);
      return;
    }

    final auth = context.read<AuthProvider>();
    final uid = auth.firebaseUser?.uid;
    final profile = auth.userProfile;
    if (uid == null || profile == null) return;

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      final subject = _subjectController.text.trim();
      final message = _messageController.text.trim();

      // Upload attachments — we need a temporary threadId placeholder
      // Since thread doesn't exist yet, we'll create thread first then upload
      // Actually, let's create thread first with no attachments, get threadId,
      // then upload and update. Or simpler: create a unique folder key.
      List<Map<String, dynamic>>? attachments;

      if (_selectedFiles.isNotEmpty) {
        // Use a temp key for upload path, then create thread
        final tempKey = DateTime.now().millisecondsSinceEpoch.toString();
        attachments = [];
        for (final file in _selectedFiles) {
          final name = p.basename(file.path);
          final url = await _storageService.uploadMessageAttachment(
            file: file,
            threadId: tempKey,
          );
          attachments.add({
            'id': '${DateTime.now().millisecondsSinceEpoch}_$name',
            'name': name,
            'url': url,
            'type': _mimeType(file.path),
            'size': file.lengthSync(),
          });
        }
      }

      await _service.createThread(
        patientId: uid,
        patientName: profile.fullName,
        subject: subject,
        firstMessage: message,
        senderId: uid,
        senderName: profile.fullName,
        priority: _priority,
        attachments: attachments,
      );

      // Notify admins
      final preview = message.isNotEmpty
          ? (message.length > 60 ? '${message.substring(0, 60)}...' : message)
          : '[Attachment]';
      await NotificationHelper.notifyAdmins(
        type: 'new_message',
        title: 'New Message from ${profile.fullName}',
        message: '$subject — "$preview"',
        patientId: uid,
      );

      if (mounted) {
        Navigator.pop(context);
        widget.onSent?.call();
      }
    } catch (e) {
      setState(() {
        _error = 'Failed to send message';
        _submitting = false;
      });
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

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Container(
      padding: EdgeInsets.only(bottom: bottomInset),
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.85,
      ),
      decoration: BoxDecoration(
        color: AppColors.surfaceCard,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const BottomSheetHeader(
              icon: Icons.edit,
              color: AppColors.success,
              title: 'New Message',
            ),

            // Scrollable content
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Error
                    if (_error != null) ...[
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.red.shade50,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(_error!,
                            style: TextStyle(
                                color: Colors.red.shade700, fontSize: 14)),
                      ),
                      const SizedBox(height: 16),
                    ],

                    // Subject
                    TextField(
                      controller: _subjectController,
                      maxLength: FieldLimits.messageSubjectMax,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: InputDecoration(
                        labelText: 'Subject',
                        counterText: '',
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),

                    // Priority
                    Text('Priority',
                        style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                            color: AppColors.textMedium)),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      children: {
                        'low': 'Low',
                        'normal': 'Normal',
                        'high': 'High',
                        'urgent': 'Urgent',
                      }.entries.map((e) {
                        final selected = _priority == e.key;
                        return ChoiceChip(
                          label: Text(e.value),
                          selected: selected,
                          selectedColor: e.key == 'urgent'
                              ? Colors.red.shade100
                              : e.key == 'high'
                                  ? Colors.orange.shade100
                                  : AppColors.primary
                                      .withValues(alpha: 0.15),
                          onSelected: (_) =>
                              setState(() => _priority = e.key),
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 16),

                    // Message
                    TextField(
                      controller: _messageController,
                      maxLength: FieldLimits.messageContentMax,
                      maxLines: 5,
                      minLines: 3,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: InputDecoration(
                        labelText: 'Message',
                        alignLabelWithHint: true,
                        counterText: '',
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),

                    // Attachments
                    Row(
                      children: [
                        TextButton.icon(
                          onPressed: _submitting ? null : _pickFiles,
                          icon: const Icon(Icons.attach_file, size: 18),
                          label: const Text('Attach Files'),
                        ),
                      ],
                    ),

                    if (_selectedFiles.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      ...List.generate(_selectedFiles.length, (i) {
                        final file = _selectedFiles[i];
                        final name = p.basename(file.path);
                        return Container(
                          margin: const EdgeInsets.only(bottom: 6),
                          padding: const EdgeInsets.symmetric(
                              horizontal: 10, vertical: 8),
                          decoration: BoxDecoration(
                            color: AppColors.background,
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: AppColors.divider),
                          ),
                          child: Row(
                            children: [
                              Icon(_fileIcon(file.path),
                                  size: 18, color: AppColors.primary),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.start,
                                  children: [
                                    Text(name,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: TextStyle(
                                            fontSize: 13,
                                            color: AppColors.textDark)),
                                    Text(_formatSize(file.lengthSync()),
                                        style: TextStyle(
                                            fontSize: 11,
                                            color: AppColors.textMedium)),
                                  ],
                                ),
                              ),
                              GestureDetector(
                                onTap: () => _removeFile(i),
                                child: Icon(Icons.close,
                                    size: 18, color: Colors.grey.shade500),
                              ),
                            ],
                          ),
                        );
                      }),
                    ],

                    const SizedBox(height: 20),

                    // Submit
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: _submitting ? null : _submit,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.primary,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                        child: _submitting
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(
                                    strokeWidth: 2, color: Colors.white),
                              )
                            : const Text('Send Message',
                                style: TextStyle(
                                    fontSize: 16, fontWeight: FontWeight.w600)),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
