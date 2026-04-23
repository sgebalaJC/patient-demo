import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config/colors.dart';
import '../config/branding.dart';
import '../widgets/page_header.dart';

class ContactScreen extends StatelessWidget {
  final VoidCallback? onBack;

  const ContactScreen({super.key, this.onBack});

  Future<void> _openMaps() async {
    final url = Uri.parse(
        'https://www.google.com/maps/search/?api=1&query=${branding.address.mapsQuery}');
    if (await canLaunchUrl(url)) await launchUrl(url);
  }

  Future<void> _sendEmail() async {
    final url = Uri.parse('mailto:${branding.supportEmail}');
    if (await canLaunchUrl(url)) await launchUrl(url);
  }

  Future<void> _callPhone(String phone) async {
    final url = Uri.parse('tel:$phone');
    if (await canLaunchUrl(url)) await launchUrl(url);
  }

  @override
  Widget build(BuildContext context) {
    final phone = branding.supportPhone;
    final fax = branding.fax;
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            PageHeader(
              icon: Icons.contact_mail_outlined,
              title: 'Contact Us',
              subtitle: 'Reach the practice',
              onBack: onBack ?? () => Navigator.pop(context),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  _ContactCard(
                    icon: Icons.business,
                    title: branding.practiceName,
                    subtitle: 'Healthcare Services',
                  ),

                  const SizedBox(height: 12),

                  _ContactCard(
                    icon: Icons.location_on,
                    title: 'Address',
                    subtitle:
                        '${branding.address.street}\n${branding.address.city}, ${branding.address.state} ${branding.address.zip}',
                    actionLabel: 'Get Directions',
                    onAction: _openMaps,
                  ),

                  const SizedBox(height: 12),

                  _ContactCard(
                    icon: Icons.email,
                    title: 'Email',
                    subtitle: branding.supportEmail,
                    actionLabel: 'Send Email',
                    onAction: _sendEmail,
                  ),

                  if (phone != null) ...[
                    const SizedBox(height: 12),
                    _ContactCard(
                      icon: Icons.phone,
                      title: 'Phone',
                      subtitle: phone,
                      actionLabel: 'Call',
                      onAction: () => _callPhone(phone),
                    ),
                  ],

                  if (fax != null && fax.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    _ContactCard(
                      icon: Icons.print,
                      title: 'Fax',
                      subtitle: fax,
                    ),
                  ],

                  const SizedBox(height: 12),

                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceCard,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color: AppColors.primary.withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Icon(Icons.access_time,
                                  color: AppColors.primary, size: 22),
                            ),
                            const SizedBox(width: 12),
                            Text('Office Hours',
                                style: TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w600,
                                    color: AppColors.textPrimary)),
                          ],
                        ),
                        const SizedBox(height: 16),
                        ...branding.hours.map((h) => Padding(
                              padding: const EdgeInsets.only(bottom: 8),
                              child: Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(h.day,
                                      style: TextStyle(
                                          color: AppColors.textSecondary,
                                          fontSize: 14)),
                                  Text(h.time,
                                      style: TextStyle(
                                          color: AppColors.textPrimary,
                                          fontWeight: FontWeight.w500,
                                          fontSize: 14)),
                                ],
                              ),
                            )),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ContactCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final String? actionLabel;
  final VoidCallback? onAction;

  const _ContactCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.actionLabel,
    this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surfaceCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: AppColors.primary, size: 22),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textPrimary)),
                const SizedBox(height: 4),
                Text(subtitle,
                    style: TextStyle(
                        color: AppColors.textSecondary, fontSize: 14)),
                if (actionLabel != null) ...[
                  const SizedBox(height: 8),
                  GestureDetector(
                    onTap: onAction,
                    child: Text(actionLabel!,
                        style: TextStyle(
                            color: AppColors.primary,
                            fontWeight: FontWeight.w500,
                            fontSize: 14)),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
