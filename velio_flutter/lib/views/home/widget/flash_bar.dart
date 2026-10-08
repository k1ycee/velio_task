import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';

/// Error strip that drops in from the top, stays for [hold], slides back up, then calls [onDismiss].
/// Place it at the top of a clipping Stack so it appears to fall from under the app bar.
class FlashBar extends HookWidget {
  const FlashBar({super.key, required this.message, required this.onDismiss});

  static const slide = Duration(milliseconds: 250);
  static const hold = Duration(seconds: 2);

  final String message;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final controller = useAnimationController(duration: slide * 2 + hold);
    useEffect(() {
      // Completes only if the whole run finishes, never when the widget is removed early.
      controller.forward().then((_) => onDismiss());
      return null;
    }, const []);

    final slideWeight = slide.inMilliseconds.toDouble();
    final position = controller.drive(
      TweenSequence<Offset>([
        TweenSequenceItem(
          tween: Tween(begin: const Offset(0, -1), end: Offset.zero).chain(CurveTween(curve: Curves.easeOutCubic)),
          weight: slideWeight,
        ),
        TweenSequenceItem(tween: ConstantTween(Offset.zero), weight: hold.inMilliseconds.toDouble()),
        TweenSequenceItem(
          tween: Tween(begin: Offset.zero, end: const Offset(0, -1)).chain(CurveTween(curve: Curves.easeInCubic)),
          weight: slideWeight,
        ),
      ]),
    );

    final scheme = Theme.of(context).colorScheme;
    return SlideTransition(
      position: position,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
        child: Semantics(
          liveRegion: true,
          // Inset with the web notice's 8px radius, so it reads as the same component dropping in.
          child: Material(
            color: scheme.errorContainer,
            elevation: 2,
            borderRadius: BorderRadius.circular(8),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              child: Row(
                children: [
                  Icon(Icons.error_outline, color: scheme.onErrorContainer),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(message, style: TextStyle(color: scheme.onErrorContainer)),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
