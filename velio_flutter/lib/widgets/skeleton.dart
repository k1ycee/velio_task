import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';

/// Placeholder shaped like the content that's loading. It fades in after 150ms, so fast loads
/// never flash, then pulses gently; with reduced motion it stays still.
class Skeleton extends HookWidget {
  const Skeleton({super.key, required this.child, this.label = 'Loading'});

  /// Built from [SkeletonBox]es.
  final Widget child;
  final String label;

  @override
  Widget build(BuildContext context) {
    final still = MediaQuery.disableAnimationsOf(context);
    final appear = useAnimationController(duration: const Duration(milliseconds: 150));
    final pulse = useAnimationController(duration: const Duration(milliseconds: 900));
    useEffect(() {
      // Stay invisible for the first 150ms, then show.
      appear.animateTo(1, duration: const Duration(milliseconds: 150), curve: const Threshold(0.99));
      if (!still) pulse.repeat(reverse: true);
      return null;
    }, [still]);

    return Semantics(
      label: label,
      liveRegion: true,
      child: ExcludeSemantics(
        child: FadeTransition(
          opacity: appear,
          child: FadeTransition(opacity: Tween(begin: 1.0, end: 0.5).animate(pulse), child: child),
        ),
      ),
    );
  }
}

class SkeletonBox extends StatelessWidget {
  const SkeletonBox({super.key, this.width, required this.height, this.radius = 6});

  final double? width;
  final double height;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(radius),
      ),
    );
  }
}
