import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/auth_provider.dart';
import '../../services/firestore/notifications_service.dart';
import '../../services/firestore/messages_service.dart';
import '../../models/notification.dart';
import '../../config/colors.dart';
import '../../utils/date_formatting.dart';
import '../messages/thread_detail_screen.dart';

class NotificationsScreen extends StatefulWidget {
  final void Function(int index)? onNavigate;

  const NotificationsScreen({super.key, this.onNavigate});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  final _service = NotificationsService();
  final _messagesService = MessagesService();
  List<AppNotification> _notifications = [];
  bool _loading = true;
  String? _uid;

  @override
  void initState() {
    super.initState();
    _uid = context.read<AuthProvider>().firebaseUser?.uid;
    _loadNotifications();
  }

  Future<void> _loadNotifications() async {
    if (_uid == null) return;
    setState(() => _loading = true);
    try {
      final snapshot = await _service.getPatientNotifications(_uid!);
      if (mounted) {
        setState(() {
          _notifications = snapshot;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _markAllRead() async {
    if (_uid == null) return;
    await _service.markAllAsRead(_uid!);
    _loadNotifications();
  }

  void _handleTap(AppNotification n, bool isUnread) async {
    if (isUnread && _uid != null) {
      await _service.markAsRead(n.id, _uid!);
    }

    if (!mounted) return;

    final navigator = Navigator.of(context);

    // Determine which tab to navigate to
    int? tabIndex;
    switch (n.type) {
      case NotificationType.appointmentBooked:
      case NotificationType.appointmentCancelled:
      case NotificationType.appointmentConfirmed:
        tabIndex = 1; // Appointments
        break;
      case NotificationType.newMessage:
        final threadId = n.meta?['threadId'];
        if (threadId != null) {
          // Open the specific thread
          final thread = await _messagesService.getThread(threadId);
          if (thread != null) {
            navigator.pop();
            navigator.push(
              MaterialPageRoute(
                builder: (_) => ThreadDetailScreen(thread: thread),
              ),
            );
            return;
          }
        }
        tabIndex = 2; // Fallback to messages tab
        break;
      case NotificationType.refillRequest:
        tabIndex = 3; // Refills
        break;
      case NotificationType.newPatient:
      case NotificationType.system:
        break; // No deep link
    }

    if (tabIndex != null && widget.onNavigate != null) {
      navigator.pop(); // Close notifications screen
      widget.onNavigate!(tabIndex);
    } else {
      _loadNotifications(); // Just refresh read state
    }
  }

  @override
  Widget build(BuildContext context) {
    final unreadCount =
        _notifications.where((n) => !n.isReadByUser(_uid ?? '')).length;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Notifications'),
        backgroundColor: AppColors.background,
        foregroundColor: AppColors.textDark,
        elevation: 0,
        actions: [
          if (unreadCount > 0)
            TextButton(
              onPressed: _markAllRead,
              child: const Text('Mark all read'),
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _notifications.isEmpty
              ? RefreshIndicator(
                  onRefresh: _loadNotifications,
                  child: ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    children: [
                      SizedBox(
                          height: MediaQuery.of(context).size.height * 0.3),
                      Icon(Icons.notifications_none,
                          size: 48, color: Colors.grey.shade400),
                      const SizedBox(height: 16),
                      Text('No notifications',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.grey.shade500)),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _loadNotifications,
                  child: ListView.builder(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    itemCount: _notifications.length,
                    itemBuilder: (context, index) {
                      final n = _notifications[index];
                      final isUnread = !n.isReadByUser(_uid ?? '');
                      return _NotificationTile(
                        notification: n,
                        isUnread: isUnread,
                        onTap: () => _handleTap(n, isUnread),
                      );
                    },
                  ),
                ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  final AppNotification notification;
  final bool isUnread;
  final VoidCallback? onTap;

  const _NotificationTile({
    required this.notification,
    required this.isUnread,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: isUnread ? AppColors.primary.withValues(alpha: 0.06) : AppColors.surfaceCard,
          border: Border(
            bottom: BorderSide(color: Colors.grey.shade100),
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: _iconColor.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(_icon, color: _iconColor, size: 18),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    notification.title,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight:
                          isUnread ? FontWeight.w600 : FontWeight.w500,
                      color: AppColors.textDark,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    notification.message,
                    style: TextStyle(
                      fontSize: 13,
                      color: Colors.grey.shade600,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (notification.createdAt != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      formatRelativeTime(notification.createdAt!),
                      style: TextStyle(
                        fontSize: 11,
                        color: Colors.grey.shade400,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            if (isUnread)
              Container(
                width: 8,
                height: 8,
                margin: const EdgeInsets.only(top: 6, left: 8),
                decoration: BoxDecoration(
                  color: AppColors.primary,
                  shape: BoxShape.circle,
                ),
              ),
          ],
        ),
      ),
    );
  }

  IconData get _icon {
    switch (notification.type) {
      case NotificationType.appointmentBooked:
      case NotificationType.appointmentCancelled:
      case NotificationType.appointmentConfirmed:
        return Icons.calendar_today;
      case NotificationType.newMessage:
        return Icons.message_outlined;
      case NotificationType.refillRequest:
        return Icons.medication_outlined;
      case NotificationType.newPatient:
        return Icons.person_add_outlined;
      case NotificationType.system:
        return Icons.info_outline;
    }
  }

  Color get _iconColor {
    switch (notification.type) {
      case NotificationType.appointmentBooked:
      case NotificationType.appointmentConfirmed:
        return AppColors.primary;
      case NotificationType.appointmentCancelled:
        return Colors.red;
      case NotificationType.newMessage:
        return AppColors.success;
      case NotificationType.refillRequest:
        return AppColors.warning;
      case NotificationType.newPatient:
        return AppColors.purple;
      case NotificationType.system:
        return Colors.grey;
    }
  }

}
