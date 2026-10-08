import 'package:flutter/material.dart';

/// Full-width primary button with a working state: while [busy] it ignores taps but keeps its
/// colour (it's working, not unavailable) and shows a spinner next to [busyLabel].
class BusyButton extends StatelessWidget {
  const BusyButton({
    super.key,
    required this.label,
    required this.busyLabel,
    required this.busy,
    required this.onPressed,
  });

  final String label;
  final String busyLabel;
  final bool busy;

  /// Null disables the button (e.g. sold out).
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return FilledButton(
      onPressed: busy ? null : onPressed,
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        disabledBackgroundColor: busy ? scheme.primary.withValues(alpha: 0.85) : null,
        disabledForegroundColor: busy ? scheme.onPrimary : null,
      ),
      child: AnimatedSwitcher(
        duration: MediaQuery.disableAnimationsOf(context) ? Duration.zero : const Duration(milliseconds: 150),
        child: busy
            ? Row(
                key: const ValueKey('busy'),
                mainAxisSize: MainAxisSize.min,
                children: [
                  SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: scheme.onPrimary),
                  ),
                  const SizedBox(width: 10),
                  Text(busyLabel),
                ],
              )
            : Text(label, key: const ValueKey('idle')),
      ),
    );
  }
}
