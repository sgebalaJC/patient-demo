import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../config/branding.dart';
import '../../config/colors.dart';
import '../../providers/auth_provider.dart';
import '../../services/firestore/subscriptions_service.dart';
import '../../widgets/page_header.dart';

/// Patient-facing membership / billing screen.
///
/// Reads plans + current subscription from Firestore (so it stays in sync
/// with the Stripe webhook), supports cancel-at-period-end natively, and
/// hands off subscribe to the web billing page where Stripe Checkout runs.
class BillingScreen extends StatefulWidget {
  final VoidCallback? onBack;
  const BillingScreen({super.key, this.onBack});

  @override
  State<BillingScreen> createState() => _BillingScreenState();
}

class _BillingScreenState extends State<BillingScreen> {
  List<SubscriptionPlan> _plans = [];
  bool _loading = true;
  bool _cancelling = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadPlans();
  }

  Future<void> _loadPlans() async {
    try {
      final plans = await SubscriptionsService.listPlans();
      if (mounted) {
        setState(() {
          _plans = plans;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Could not load membership plans.';
        });
      }
    }
  }

  Future<void> _openCheckout() async {
    // Stripe Checkout completes on the web billing page — same approach as
    // the SubscriptionStatusCard "Manage" button.
    final url = Uri.parse('https://${branding.domain}/billing');
    if (await canLaunchUrl(url)) {
      await launchUrl(url, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _confirmCancel() async {
    final controller = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) {
          final canCancel = controller.text.trim().toUpperCase() == 'CANCEL';
          return AlertDialog(
            backgroundColor: AppColors.surfaceCard,
            title: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: Colors.red.shade50,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(Icons.warning_amber_rounded,
                      color: Colors.red.shade600),
                ),
                const SizedBox(width: 12),
                const Expanded(child: Text('Cancel membership')),
              ],
            ),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.red.shade50,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.red.shade200),
                  ),
                  child: Text(
                    "Your membership will end on the next renewal date. "
                    "You'll keep access until then but won't be charged again.",
                    style:
                        TextStyle(fontSize: 13, color: Colors.red.shade900),
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  'Type CANCEL to confirm',
                  style: TextStyle(
                      fontSize: 13, color: AppColors.textMedium),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: controller,
                  decoration: InputDecoration(
                    hintText: 'CANCEL',
                    border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8)),
                  ),
                  onChanged: (_) => setLocal(() {}),
                  textCapitalization: TextCapitalization.characters,
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(false),
                child: const Text('Keep membership'),
              ),
              ElevatedButton(
                onPressed: canCancel ? () => Navigator.of(ctx).pop(true) : null,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.red.shade600,
                  foregroundColor: Colors.white,
                ),
                child: const Text('Cancel membership'),
              ),
            ],
          );
        },
      ),
    );
    if (confirmed != true) return;

    setState(() {
      _cancelling = true;
      _error = null;
    });
    try {
      await SubscriptionsService.cancel();
    } catch (e) {
      if (mounted) {
        setState(() => _error = 'Could not cancel membership.');
      }
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  String _formatAmount(int amount, String currency) {
    final dollars = amount / 100;
    final symbol = currency.toLowerCase() == 'usd' ? '\$' : '$currency '.toUpperCase();
    return '$symbol${dollars.toStringAsFixed(dollars % 1 == 0 ? 0 : 2)}';
  }

  String _formatDate(num? secondsSinceEpoch) {
    if (secondsSinceEpoch == null) return '';
    final d =
        DateTime.fromMillisecondsSinceEpoch(secondsSinceEpoch.toInt() * 1000);
    return '${d.month}/${d.day}/${d.year}';
  }

  @override
  Widget build(BuildContext context) {
    final uid = context.watch<AuthProvider>().firebaseUser?.uid;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: Column(
        children: [
          PageHeader(
            icon: Icons.credit_card,
            title: 'Membership',
            subtitle: 'Manage your ${branding.shortName} membership.',
            onBack: widget.onBack ?? () => Navigator.of(context).pop(),
          ),
          if (uid == null)
            const Expanded(
                child: Center(child: Text('Sign in to view membership.')))
          else
            Expanded(
              child: StreamBuilder<Map<String, dynamic>?>(
                stream: SubscriptionsService.watch(uid),
                builder: (context, snap) {
                  if (_loading ||
                      snap.connectionState == ConnectionState.waiting) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  final data = snap.data;
                  final status = data?['status'] as String?;
                  final isActive = status == 'active' ||
                      status == 'trialing' ||
                      status == 'past_due';
                  final activePlanId = data?['priceId'] as String?;
                  final currentPlan = activePlanId != null
                      ? _plans.where((p) => p.id == activePlanId).firstOrNull
                      : null;

                  return RefreshIndicator(
                    onRefresh: _loadPlans,
                    child: ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.all(16),
                      children: [
                        if (_error != null) ...[
                          _buildErrorBanner(_error!),
                          const SizedBox(height: 16),
                        ],
                        if (isActive)
                          _buildActiveCard(data!, currentPlan)
                        else
                          _buildPlansList(),
                      ],
                    ),
                  );
                },
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildErrorBanner(String message) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.red.shade50,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.red.shade200),
      ),
      child: Row(
        children: [
          Icon(Icons.error_outline, color: Colors.red.shade700, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Text(message,
                style: TextStyle(fontSize: 13, color: Colors.red.shade900)),
          ),
        ],
      ),
    );
  }

  Widget _buildActiveCard(
      Map<String, dynamic> sub, SubscriptionPlan? currentPlan) {
    final status = sub['status'] as String?;
    final cancelAtPeriodEnd = sub['cancelAtPeriodEnd'] == true;
    final cancelAt = sub['cancelAt'] as num?;
    final currentPeriodEnd = sub['currentPeriodEnd'] as num?;

    Color badgeBg;
    Color badgeFg;
    String badgeText;
    switch (status) {
      case 'active':
        badgeBg = Colors.green.shade100;
        badgeFg = Colors.green.shade800;
        badgeText = 'Active';
        break;
      case 'trialing':
        badgeBg = Colors.blue.shade100;
        badgeFg = Colors.blue.shade800;
        badgeText = 'Trialing';
        break;
      case 'past_due':
        badgeBg = Colors.amber.shade100;
        badgeFg = Colors.amber.shade900;
        badgeText = 'Past due';
        break;
      default:
        badgeBg = AppColors.divider;
        badgeFg = AppColors.textMedium;
        badgeText = status ?? 'Unknown';
    }

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.surfaceCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.divider),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Current membership',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
              color: AppColors.textDark,
            ),
          ),
          const SizedBox(height: 6),
          if (currentPlan != null)
            Text(
              '${currentPlan.name} — '
              '${_formatAmount(currentPlan.amount, currentPlan.currency)} / ${currentPlan.interval}',
              style: TextStyle(fontSize: 13, color: AppColors.textMedium),
            ),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: badgeBg,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              badgeText,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: badgeFg,
              ),
            ),
          ),
          const SizedBox(height: 12),
          if (cancelAtPeriodEnd && cancelAt != null)
            Text(
              'Will cancel on ${_formatDate(cancelAt)}.',
              style: TextStyle(fontSize: 13, color: Colors.amber.shade900),
            )
          else if (currentPeriodEnd != null)
            Text(
              'Renews on ${_formatDate(currentPeriodEnd)}.',
              style: TextStyle(fontSize: 13, color: AppColors.textMedium),
            ),
          if (!cancelAtPeriodEnd) ...[
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: _cancelling ? null : _confirmCancel,
                icon: _cancelling
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.cancel_outlined, size: 18),
                label: Text(_cancelling ? 'Cancelling…' : 'Cancel membership'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.red.shade700,
                  side: BorderSide(color: Colors.red.shade300),
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10)),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildPlansList() {
    if (_plans.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: AppColors.surfaceCard,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.divider),
        ),
        child: Column(
          children: [
            Text(
              'No plans available yet',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: AppColors.textDark,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Membership plans are not yet configured. Please check back later.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13, color: AppColors.textMedium),
            ),
          ],
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Choose a membership',
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: AppColors.textDark,
          ),
        ),
        const SizedBox(height: 12),
        for (final plan in _plans) ...[
          _buildPlanCard(plan),
          const SizedBox(height: 12),
        ],
      ],
    );
  }

  Widget _buildPlanCard(SubscriptionPlan plan) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.surfaceCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.divider),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            plan.name,
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w600,
              color: AppColors.textDark,
            ),
          ),
          if (plan.description != null && plan.description!.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              plan.description!,
              style: TextStyle(fontSize: 13, color: AppColors.textMedium),
            ),
          ],
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                _formatAmount(plan.amount, plan.currency),
                style: TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.bold,
                  color: AppColors.textDark,
                ),
              ),
              Text(
                ' / ${plan.interval}',
                style: TextStyle(fontSize: 13, color: AppColors.textMedium),
              ),
            ],
          ),
          if (plan.features.isNotEmpty) ...[
            const SizedBox(height: 16),
            for (final f in plan.features) ...[
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.check_circle,
                        size: 16, color: AppColors.primary),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        f,
                        style: TextStyle(
                          fontSize: 13,
                          color: AppColors.textMedium,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _openCheckout,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10)),
              ),
              child: const Text(
                'Subscribe',
                style: TextStyle(fontWeight: FontWeight.w600),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
