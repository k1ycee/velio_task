import 'package:flutter/material.dart';

import '../core/constants/velio_theme.dart';

/// Top of every screen, in place of an app bar: an optional "← Back" link (web: "← All activities")
/// and the page title (web `h1`).
class PageHeader extends StatelessWidget {
  const PageHeader({super.key, required this.title, this.onBack, this.subtitle});

  final String title;
  final String? subtitle;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    final t = VelioTokens.of(context);
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (onBack != null)
            Semantics(
              button: true,
              label: 'Back',
              excludeSemantics: true,
              child: InkWell(
                onTap: onBack,
                borderRadius: BorderRadius.circular(6),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  child: Text(
                    '← Back',
                    style: TextStyle(color: t.link, decoration: TextDecoration.underline, decorationColor: t.link),
                  ),
                ),
              ),
            ),
          Text(title, style: text.headlineSmall),
          if (subtitle != null) ...[const SizedBox(height: 6), Text(subtitle!, style: TextStyle(color: t.muted))],
        ],
      ),
    );
  }
}

/// Web `.card`: white surface, 1px border, 12px radius, 20px padding. An optional [cover] runs flush
/// across the top, edge to edge, clipped to the card's corners.
class Panel extends StatelessWidget {
  const Panel({super.key, required this.child, this.padding = const EdgeInsets.all(20), this.cover});

  final Widget child;
  final EdgeInsetsGeometry padding;
  final Widget? cover;

  @override
  Widget build(BuildContext context) {
    final t = VelioTokens.of(context);
    return Container(
      width: double.infinity,
      padding: cover == null ? padding : EdgeInsets.zero,
      clipBehavior: cover == null ? Clip.none : Clip.antiAlias,
      decoration: BoxDecoration(
        color: t.surface,
        border: Border.all(color: t.border),
        borderRadius: BorderRadius.circular(12),
      ),
      child: cover == null
          ? child
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                cover!,
                Padding(padding: padding, child: child),
              ],
            ),
    );
  }
}

/// Web `.badge`: small uppercase pill; `vouch` gets the purple tone.
class VelioBadge extends StatelessWidget {
  const VelioBadge(this.label, {super.key, this.vouch = false});

  final String label;
  final bool vouch;

  @override
  Widget build(BuildContext context) {
    final t = VelioTokens.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: vouch ? t.vouchBg : t.border, borderRadius: BorderRadius.circular(999)),
      child: Text(
        label.toUpperCase(),
        style: TextStyle(fontSize: 12, letterSpacing: 0.4, color: vouch ? t.vouch : t.muted),
      ),
    );
  }
}

enum NoticeTone { info, warn, error }

/// Web `.notice` (warm) and error boxes: tinted, 6px radius, body text.
class Notice extends StatelessWidget {
  const Notice(this.text, {super.key, this.tone = NoticeTone.warn, this.action});

  final String text;
  final NoticeTone tone;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final t = VelioTokens.of(context);
    final (bg, fg) = switch (tone) {
      NoticeTone.info => (t.vouchBg, t.text),
      NoticeTone.warn => (t.warnBg, t.text),
      NoticeTone.error => (t.dangerBg, t.danger),
    };
    return Semantics(
      liveRegion: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(6)),
        child: Row(
          children: [
            Expanded(
              child: Text(text, style: TextStyle(color: fg, fontSize: 15)),
            ),
            ?action,
          ],
        ),
      ),
    );
  }
}
