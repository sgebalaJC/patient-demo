import 'package:flutter/material.dart';
import '../config/colors.dart';

class StatusChip extends StatelessWidget {
  final String label;
  final Color color;

  const StatusChip({super.key, required this.label, required this.color});

  factory StatusChip.appointment(String status) {
    final (label, color) = switch (status) {
      'confirmed' => ('Confirmed', AppColors.success),
      'cancelled' => ('Cancelled', AppColors.error),
      'completed' => ('Completed', AppColors.success),
      'in-progress' => ('In Progress', AppColors.warning),
      'no-show' => ('No Show', Colors.grey),
      _ => ('Scheduled', AppColors.primary),
    };
    return StatusChip(label: label, color: color);
  }

  factory StatusChip.refill(String status) {
    final (label, color) = switch (status) {
      'approved' => ('Approved', AppColors.success),
      'denied' => ('Denied', AppColors.error),
      'completed' => ('Completed', AppColors.success),
      _ => ('Pending', AppColors.primary),
    };
    return StatusChip(label: label, color: color);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w500,
          color: color,
        ),
      ),
    );
  }
}
