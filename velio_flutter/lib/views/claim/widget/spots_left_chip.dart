import 'package:flutter/material.dart';

class SpotsLeftChip extends StatelessWidget {
  const SpotsLeftChip({super.key, required this.spotsLeft, required this.capacity});

  final int spotsLeft;
  final int capacity;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final soldOut = spotsLeft == 0;
    return Semantics(
      liveRegion: true,
      child: Chip(
        avatar: Icon(soldOut ? Icons.block : Icons.event_seat, size: 18),
        label: Text(soldOut ? 'Sold out' : '$spotsLeft of $capacity spots left'),
        backgroundColor: soldOut ? scheme.errorContainer : scheme.surfaceContainerHighest,
      ),
    );
  }
}
