import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/auth_provider.dart';
import '../../services/firestore/refills_service.dart';
import '../../models/refill.dart';
import '../../config/colors.dart';
import '../../widgets/status_chip.dart';
import '../../widgets/paginated_list.dart';
import 'new_refill_sheet.dart';
import 'refill_detail_screen.dart';
import '../../widgets/page_header.dart';

class RefillsScreen extends StatefulWidget {
  final VoidCallback? onBack;
  const RefillsScreen({super.key, this.onBack});

  @override
  State<RefillsScreen> createState() => _RefillsScreenState();
}

class _RefillsScreenState extends State<RefillsScreen> {
  final _service = RefillsService();
  final _listKey = GlobalKey<PaginatedListState<PrescriptionRefill>>();

  @override
  Widget build(BuildContext context) {
    final uid = context.read<AuthProvider>().firebaseUser?.uid;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: Column(
        children: [
          PageHeader(
            icon: Icons.medication_outlined,
            title: 'Prescription Refills',
            subtitle: 'Request and track your refills',
            onBack: widget.onBack,
          ),
          Expanded(
            child: uid == null
                ? const SizedBox.shrink()
                : PaginatedList<PrescriptionRefill>(
                    key: _listKey,
                    onLoad: (cursor) =>
                        _service.getPatientRefillsPage(uid, cursor: cursor),
                    itemBuilder: (context, refill) => _RefillTile(
                      refill: refill,
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) =>
                                RefillDetailScreen(refill: refill),
                          ),
                        );
                      },
                    ),
                    emptyIcon: Icons.medication_outlined,
                    emptyText: 'No refill requests',
                  ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        backgroundColor: AppColors.primary,
        onPressed: () {
          NewRefillSheet.show(context, onCreated: () {
            _listKey.currentState?.refresh();
          });
        },
        child: const Icon(Icons.add, color: Colors.white),
      ),
    );
  }
}

class _RefillTile extends StatelessWidget {
  final PrescriptionRefill refill;
  final VoidCallback? onTap;
  const _RefillTile({required this.refill, this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(16),
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
                    fontWeight: FontWeight.w600,
                    fontSize: 15,
                    color: AppColors.textDark,
                  ),
                ),
              ),
              StatusChip.refill(refill.status.name),
            ],
          ),
          if (refill.dosage != null) ...[
            const SizedBox(height: 4),
            Text(
              'Dosage: ${refill.dosage}',
              style: TextStyle(fontSize: 13, color: Colors.grey.shade600),
            ),
          ],
          if (refill.pharmacyName != null) ...[
            const SizedBox(height: 2),
            Text(
              'Pharmacy: ${refill.pharmacyName}',
              style: TextStyle(fontSize: 13, color: Colors.grey.shade600),
            ),
          ],
        ],
      ),
    ),
    );
  }
}
