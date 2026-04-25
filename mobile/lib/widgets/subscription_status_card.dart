import 'package:flutter/material.dart';
import '../config/colors.dart';
import '../config/branding.dart';
import '../screens/billing/billing_screen.dart';
import '../services/firestore/subscriptions_service.dart';

/// Read-only membership status card. Tapping "Manage membership" opens the
/// native billing screen; Stripe Checkout itself still runs on the web
/// billing page (subscribe handoff).
class SubscriptionStatusCard extends StatelessWidget {
  final String uid;

  const SubscriptionStatusCard({super.key, required this.uid});

  void _openBilling(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const BillingScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<Map<String, dynamic>?>(
      stream: SubscriptionsService.watch(uid),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const SizedBox.shrink();
        }
        final data = snapshot.data;
        final status = data?['status'] as String?;
        final isActive = status == 'active' || status == 'trialing';
        final cancelAtPeriodEnd = data?['cancelAtPeriodEnd'] == true;

        return Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.surfaceCard,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.divider),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(Icons.card_membership, color: AppColors.primary),
                  const SizedBox(width: 8),
                  Text(
                    'Membership',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textDark,
                    ),
                  ),
                  const Spacer(),
                  if (isActive)
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: Colors.green.shade100,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        'Active',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: Colors.green.shade800,
                        ),
                      ),
                    )
                  else
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: Colors.grey.shade200,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        'None',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: Colors.grey.shade700,
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                isActive
                    ? cancelAtPeriodEnd
                        ? 'Your membership will end at the end of the current billing period.'
                        : 'You have an active ${branding.shortName} membership.'
                    : 'Subscribe to a ${branding.shortName} membership to unlock extra benefits.',
                style: TextStyle(
                  fontSize: 13,
                  color: Colors.grey.shade600,
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: () => _openBilling(context),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.primary,
                    side: BorderSide(color: AppColors.primary),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                  child: Text(
                      isActive ? 'Manage membership' : 'View plans'),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
