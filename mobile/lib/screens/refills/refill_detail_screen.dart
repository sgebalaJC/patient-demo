import 'package:flutter/material.dart';
import '../../models/refill.dart';
import '../../services/firestore/refills_service.dart';
import '../../config/colors.dart';
import '../../widgets/status_chip.dart';
import 'new_refill_sheet.dart';

class RefillDetailScreen extends StatelessWidget {
  final PrescriptionRefill refill;

  const RefillDetailScreen({super.key, required this.refill});

  @override
  Widget build(BuildContext context) {
    final isPending = refill.status == RefillStatus.pending;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text('Refill Details'),
        backgroundColor: AppColors.background,
        foregroundColor: AppColors.textDark,
        elevation: 0,
        actions: isPending
            ? [
                IconButton(
                  icon: const Icon(Icons.edit_outlined),
                  onPressed: () {
                    NewRefillSheet.show(
                      context,
                      editing: refill,
                      onCreated: () => Navigator.pop(context),
                    );
                  },
                ),
                IconButton(
                  icon: Icon(Icons.delete_outline, color: Colors.red.shade400),
                  onPressed: () => _confirmDelete(context),
                ),
              ]
            : null,
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Header
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: AppColors.surfaceCard,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Text(
                        refill.medicationName,
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textDark,
                        ),
                      ),
                    ),
                    StatusChip.refill(refill.status.name),
                  ],
                ),
                if (refill.dosage != null) ...[
                  const SizedBox(height: 8),
                  Text('Dosage: ${refill.dosage}',
                      style: TextStyle(color: Colors.grey.shade600)),
                ],
                if (refill.quantity != null) ...[
                  const SizedBox(height: 4),
                  Text('Quantity: ${refill.quantity}',
                      style: TextStyle(color: Colors.grey.shade600)),
                ],
              ],
            ),
          ),
          const SizedBox(height: 12),

          // Pharmacy info
          if (refill.pharmacyName != null) ...[
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.surfaceCard,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.local_pharmacy_outlined,
                          size: 18, color: Colors.grey.shade500),
                      const SizedBox(width: 8),
                      Text('Pharmacy',
                          style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: AppColors.textMedium)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(refill.pharmacyName!,
                      style: TextStyle(
                          fontWeight: FontWeight.w500,
                          color: AppColors.textDark)),
                  if (refill.pharmacyPhone != null) ...[
                    const SizedBox(height: 4),
                    Text(refill.pharmacyPhone!,
                        style: TextStyle(color: Colors.grey.shade600)),
                  ],
                  if (refill.pharmacyAddress != null) ...[
                    const SizedBox(height: 4),
                    Text(refill.pharmacyAddress!,
                        style: TextStyle(color: Colors.grey.shade600)),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 12),
          ],

          // Urgency & notes
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppColors.surfaceCard,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _infoRow('Urgency', _formatUrgency(refill.urgency)),
                if (refill.notes != null) ...[
                  const Divider(height: 24),
                  _infoRow('Notes', refill.notes!),
                ],
                if (refill.doctorNotes != null) ...[
                  const Divider(height: 24),
                  _infoRow('Doctor Notes', refill.doctorNotes!),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _confirmDelete(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Refill Request'),
        content: const Text(
            'Are you sure you want to delete this refill request?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () async {
              Navigator.pop(ctx);
              await RefillsService().deleteRefill(refill.id);
              if (context.mounted) Navigator.pop(context);
            },
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: Text('Delete'),
          ),
        ],
      ),
    );
  }

  Widget _infoRow(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: TextStyle(fontSize: 12, color: Colors.grey.shade500)),
        const SizedBox(height: 2),
        Text(value, style: TextStyle(color: AppColors.textDark)),
      ],
    );
  }

  String _formatUrgency(RefillUrgency urgency) {
    switch (urgency) {
      case RefillUrgency.urgent:
        return 'Urgent (2-6 days)';
      case RefillUrgency.emergency:
        return 'Emergency (within 24h)';
      default:
        return 'Routine (7+ days)';
    }
  }

}
