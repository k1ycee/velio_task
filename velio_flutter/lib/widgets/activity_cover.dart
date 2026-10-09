import 'package:flutter/material.dart';

/// Web `coverFor` (velio_web/src/discover.ts): the same four gradients, picked by activity id,
/// so an activity has the same cover in both apps. Keep the two lists in step.
const _covers = [
  [Color(0xFF1F1535), Color(0xFF3657F5)],
  [Color(0xFF212121), Color(0xFF6A3FD6)],
  [Color(0xFF1F1535), Color(0xFF0F8A6C)],
  [Color(0xFF212121), Color(0xFF0E7490)],
];

LinearGradient coverGradient(String activityId) {
  final colors = _covers[(int.tryParse(activityId) ?? 0) % _covers.length];
  // CSS `linear-gradient(135deg, …)`: top-left to bottom-right.
  return LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: colors);
}

/// Web `.event-cover`: a gradient block (8px radius unless flush in a card), with the title in white
/// at the bottom when given.
class ActivityCover extends StatelessWidget {
  const ActivityCover({
    super.key,
    required this.activityId,
    this.title,
    this.height = 120,
    this.dimmed = false,
    this.borderRadius = const BorderRadius.all(Radius.circular(8)),
  });

  final String activityId;
  final String? title;
  final double height;

  /// Past activities fade back, like their muted titles on the web.
  final bool dimmed;

  /// [BorderRadius.zero] when the cover runs flush to the top of a clipping card.
  final BorderRadius borderRadius;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: dimmed ? 0.55 : 1,
      child: Container(
        height: height,
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        alignment: Alignment.bottomLeft,
        decoration: BoxDecoration(gradient: coverGradient(activityId), borderRadius: borderRadius),
        child: title == null
            ? null
            : Text(
                title!,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 19,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.3,
                  height: 1.15,
                ),
              ),
      ),
    );
  }
}
