import 'package:flutter/material.dart';
import '../config/colors.dart';

/// Mirror of the web `Skeleton` primitive (`web/src/components/ui/Skeleton.tsx`).
/// A pulsing placeholder block — compose these to match the real layout shape
/// so screens don't jump on first paint.
class Skeleton extends StatefulWidget {
  final double? width;
  final double height;
  final BorderRadius borderRadius;

  const Skeleton({
    super.key,
    this.width,
    this.height = 12,
    this.borderRadius = const BorderRadius.all(Radius.circular(6)),
  });

  const Skeleton.circle({super.key, double size = 40})
      : width = size,
        height = size,
        borderRadius = const BorderRadius.all(Radius.circular(999));

  @override
  State<Skeleton> createState() => _SkeletonState();
}

class _SkeletonState extends State<Skeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        return Container(
          width: widget.width,
          height: widget.height,
          decoration: BoxDecoration(
            color: Color.lerp(
              AppColors.divider,
              AppColors.background,
              _controller.value,
            ),
            borderRadius: widget.borderRadius,
          ),
        );
      },
    );
  }
}

/// A card with N skeleton rows, each a leading icon + two text lines. Matches
/// the web `SkeletonList` primitive.
class SkeletonList extends StatelessWidget {
  final int rows;
  final bool showLeading;

  const SkeletonList({super.key, this.rows = 3, this.showLeading = true});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surfaceCard,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: List.generate(rows, (i) {
          return Padding(
            padding: EdgeInsets.only(bottom: i == rows - 1 ? 0 : 16),
            child: Row(
              children: [
                if (showLeading) ...[
                  const Skeleton(
                    width: 40,
                    height: 40,
                    borderRadius: BorderRadius.all(Radius.circular(10)),
                  ),
                  const SizedBox(width: 12),
                ],
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: const [
                      Skeleton(height: 14),
                      SizedBox(height: 8),
                      Skeleton(height: 10, width: 120),
                    ],
                  ),
                ),
              ],
            ),
          );
        }),
      ),
    );
  }
}
