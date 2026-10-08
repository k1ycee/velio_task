import 'package:flutter/material.dart';

import '../../../core/constants/velio_theme.dart';

/// Web `SpotsLeft`: "N of M left" in bold, amber when low (≤ a fifth of capacity), red when sold out.
class SpotsLeft extends StatelessWidget {
  const SpotsLeft({super.key, required this.spotsLeft, required this.capacity});

  final int spotsLeft;
  final int capacity;

  @override
  Widget build(BuildContext context) {
    final t = VelioTokens.of(context);
    final low = spotsLeft <= (capacity ~/ 5).clamp(1, capacity);
    return Semantics(
      liveRegion: true,
      child: Text(
        spotsLeft == 0 ? 'Sold out' : '$spotsLeft of $capacity left',
        style: TextStyle(
          fontWeight: FontWeight.w600,
          fontFeatures: const [FontFeature.tabularFigures()],
          color: spotsLeft == 0 ? t.danger : (low ? t.warn : t.text),
        ),
      ),
    );
  }
}
