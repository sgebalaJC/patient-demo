import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/auth_provider.dart';
import '../../services/firestore/messages_service.dart';
import '../../models/message_thread.dart';
import '../../config/colors.dart';
import '../../widgets/paginated_list.dart';
import 'new_message_sheet.dart';
import 'thread_detail_screen.dart';
import '../../widgets/page_header.dart';

class MessagesScreen extends StatefulWidget {
  final VoidCallback? onBack;
  const MessagesScreen({super.key, this.onBack});

  @override
  State<MessagesScreen> createState() => _MessagesScreenState();
}

class _MessagesScreenState extends State<MessagesScreen> {
  final _service = MessagesService();
  final _listKey = GlobalKey<PaginatedListState<MessageThread>>();

  @override
  Widget build(BuildContext context) {
    final uid = context.read<AuthProvider>().firebaseUser?.uid;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: Column(
        children: [
          PageHeader(
            icon: Icons.message_outlined,
            title: 'Messages',
            subtitle: 'Communicate with your healthcare team',
            onBack: widget.onBack,
          ),
          Expanded(
            child: uid == null
                ? const SizedBox.shrink()
                : PaginatedList<MessageThread>(
                    key: _listKey,
                    onLoad: (cursor) =>
                        _service.getPatientThreadsPage(uid, cursor: cursor),
                    itemBuilder: (context, thread) => _ThreadTile(
                      thread: thread,
                      onTap: () async {
                        await Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => ThreadDetailScreen(thread: thread),
                          ),
                        );
                        _listKey.currentState?.refresh();
                      },
                    ),
                    emptyIcon: Icons.message_outlined,
                    emptyText: 'No messages yet',
                  ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        backgroundColor: AppColors.primary,
        onPressed: () {
          NewMessageSheet.show(context, onSent: () {
            _listKey.currentState?.refresh();
          });
        },
        child: const Icon(Icons.edit, color: Colors.white),
      ),
    );
  }
}

class _ThreadTile extends StatelessWidget {
  final MessageThread thread;
  final VoidCallback? onTap;
  const _ThreadTile({required this.thread, this.onTap});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: AppColors.surfaceCard,
        borderRadius: BorderRadius.circular(12),
        border: thread.unreadForPatient
            ? Border.all(color: AppColors.primary, width: 1)
            : null,
      ),
      child: ListTile(
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        leading: thread.unreadForPatient
            ? CircleAvatar(
                radius: 6,
                backgroundColor: AppColors.primary,
              )
            : null,
        title: Text(
          thread.subject,
          style: TextStyle(
            fontWeight:
                thread.unreadForPatient ? FontWeight.w600 : FontWeight.w500,
          ),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: thread.lastMessage != null
            ? Text(
                thread.lastMessage!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 13,
                  color: Colors.grey.shade600,
                ),
              )
            : null,
        trailing: Icon(Icons.chevron_right, color: Colors.grey.shade400),
        onTap: onTap,
      ),
    );
  }
}
