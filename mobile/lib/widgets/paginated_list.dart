import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import '../config/colors.dart';

/// Result of a paginated Firestore query.
class PaginatedResult<T> {
  final List<T> items;
  final DocumentSnapshot? lastDoc;
  final bool hasMore;

  const PaginatedResult({
    required this.items,
    this.lastDoc,
    this.hasMore = false,
  });
}

/// A reusable paginated list with pull-to-refresh and infinite scroll.
///
/// Usage:
/// ```dart
/// PaginatedList<Appointment>(
///   onLoad: (cursor) => appointmentsService.getPage(uid, cursor: cursor),
///   itemBuilder: (context, appointment) => AppointmentTile(appointment),
///   emptyIcon: Icons.calendar_today,
///   emptyText: 'No appointments yet',
/// )
/// ```
class PaginatedList<T> extends StatefulWidget {
  /// Fetch a page of items. Pass `cursor` for subsequent pages.
  final Future<PaginatedResult<T>> Function(DocumentSnapshot? cursor) onLoad;

  /// Build a widget for each item.
  final Widget Function(BuildContext context, T item) itemBuilder;

  /// Icon shown when the list is empty.
  final IconData emptyIcon;

  /// Text shown when the list is empty.
  final String emptyText;

  /// Padding around the list.
  final EdgeInsets padding;

  const PaginatedList({
    super.key,
    required this.onLoad,
    required this.itemBuilder,
    required this.emptyIcon,
    required this.emptyText,
    this.padding = const EdgeInsets.all(16),
  });

  @override
  State<PaginatedList<T>> createState() => PaginatedListState<T>();
}

class PaginatedListState<T> extends State<PaginatedList<T>> {
  final List<T> _items = [];
  DocumentSnapshot? _cursor;
  bool _loading = true;
  bool _loadingMore = false;
  bool _hasMore = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadInitial();
  }

  Future<void> _loadInitial() async {
    setState(() => _loading = true);
    try {
      final result = await widget.onLoad(null);
      if (mounted) {
        setState(() {
          _items
            ..clear()
            ..addAll(result.items);
          _cursor = result.lastDoc;
          _hasMore = result.hasMore;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    }
  }

  Future<void> _loadMore() async {
    if (_loadingMore || !_hasMore || _cursor == null) return;
    setState(() => _loadingMore = true);
    try {
      final result = await widget.onLoad(_cursor);
      if (mounted) {
        setState(() {
          _items.addAll(result.items);
          _cursor = result.lastDoc;
          _hasMore = result.hasMore;
          _loadingMore = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  /// Allows parent widgets to trigger a refresh (e.g. after creating an item).
  Future<void> refresh() => _loadInitial();

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_error != null && _items.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 48, color: Colors.grey.shade400),
            const SizedBox(height: 16),
            Text(
              'Something went wrong',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey.shade500),
            ),
            const SizedBox(height: 16),
            TextButton.icon(
              onPressed: _loadInitial,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    if (_items.isEmpty) {
      return RefreshIndicator(
        onRefresh: _loadInitial,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            SizedBox(height: MediaQuery.of(context).size.height * 0.3),
            Icon(widget.emptyIcon, size: 48, color: Colors.grey.shade400),
            const SizedBox(height: 16),
            Text(
              widget.emptyText,
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey.shade500),
            ),
          ],
        ),
      );
    }

    final itemCount = _items.length + (_hasMore ? 1 : 0);

    return RefreshIndicator(
      onRefresh: _loadInitial,
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: widget.padding,
        itemCount: itemCount,
        itemBuilder: (context, index) {
          if (index == _items.length) {
            // Load more trigger
            _loadMore();
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 16),
              child: Center(
                child: SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: AppColors.primary,
                  ),
                ),
              ),
            );
          }
          return widget.itemBuilder(context, _items[index]);
        },
      ),
    );
  }
}
