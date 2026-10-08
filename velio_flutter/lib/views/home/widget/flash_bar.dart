import 'package:flutter/material.dart';

/// Error strip pinned to the top of a page; stays until dismissed or the next attempt.
class FlashBar extends StatelessWidget {
  const FlashBar({super.key, required this.message, required this.onDismiss});

  final String message;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      liveRegion: true,
      child: Material(
        color: scheme.errorContainer,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 4, 8),
          child: Row(
            children: [
              Icon(Icons.error_outline, color: scheme.onErrorContainer),
              const SizedBox(width: 12),
              Expanded(child: Text(message, style: TextStyle(color: scheme.onErrorContainer))),
              IconButton(
                onPressed: onDismiss,
                icon: Icon(Icons.close, color: scheme.onErrorContainer),
                tooltip: 'Dismiss',
              ),
            ],
          ),
        ),
      ),
    );
  }
}
