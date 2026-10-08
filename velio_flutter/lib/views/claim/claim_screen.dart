import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../core/api/models/invite_models.dart';
import '../../core/constants/velio_theme.dart';
import '../../core/providers.dart';
import '../../core/view_models/claim_vm.dart';
import '../../utils/format_when.dart';
import '../../widgets/surfaces.dart';
import 'widget/claim_form.dart';
import 'widget/spots_left.dart';

class ClaimScreen extends HookConsumerWidget {
  const ClaimScreen({super.key, required this.token, required this.invite});

  final String token;
  final InviteDetails invite;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vm = ref.watch(claimVM);

    useEffect(() {
      Future.microtask(() => ref.read(claimVM).start(token, invite));
      return null;
    }, [token]);
    useOnAppLifecycleStateChange((_, state) {
      if (state == AppLifecycleState.resumed) ref.read(claimVM).resume();
    });

    return Scaffold(
      body: SafeArea(
        child: switch (vm.status) {
          ClaimStatus.loading => const SizedBox.shrink(), // one frame: the invite is already loaded
          _ => _Invite(vm: vm),
        },
      ),
    );
  }
}

/// Laid out like the web plan page: back link, an activity card, then the action card.
class _Invite extends StatelessWidget {
  const _Invite({required this.vm});

  final ClaimVM vm;

  @override
  Widget build(BuildContext context) {
    final t = VelioTokens.of(context);
    final invite = vm.invite!;
    final text = Theme.of(context).textTheme;
    final l10n = MaterialLocalizations.of(context);
    final claimed = vm.status == ClaimStatus.claimed;

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        PageHeader(title: 'Your invite', onBack: () => Navigator.of(context).maybePop()),
        Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Flexible(
                    child: Text(
                      invite.isVouch ? '${invite.inviterName} vouched for you' : '${invite.inviterName} invited you',
                      style: TextStyle(color: t.muted),
                    ),
                  ),
                  const SizedBox(width: 8),
                  VelioBadge(invite.type, vouch: invite.isVouch),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(invite.activity.title, style: text.headlineSmall),
                        const SizedBox(height: 4),
                        Text(formatWhen(l10n, invite.activity.startsAt), style: TextStyle(color: t.muted)),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  SpotsLeft(spotsLeft: vm.spotsLeft, capacity: invite.activity.capacity),
                ],
              ),
              if (invite.isVouch && !claimed) ...[
                const SizedBox(height: 16),
                const Notice('A spot is being held for you.', tone: NoticeTone.info),
              ],
            ],
          ),
        ),
        const SizedBox(height: 24),
        Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (vm.message != null) ...[
                Notice(vm.message!, tone: claimed ? NoticeTone.warn : NoticeTone.error),
                const SizedBox(height: 16),
              ],
              // The form gives way to the outcome with a short fade and pop; the form keeps one key
              // across ready/claiming so its fields aren't rebuilt mid-claim.
              AnimatedSwitcher(
                duration: MediaQuery.disableAnimationsOf(context) ? Duration.zero : const Duration(milliseconds: 350),
                switchInCurve: Curves.easeOutBack,
                transitionBuilder: (child, animation) => FadeTransition(
                  opacity: animation,
                  child: ScaleTransition(scale: Tween(begin: 0.9, end: 1.0).animate(animation), child: child),
                ),
                child: switch (vm.status) {
                  ClaimStatus.claimed => _Outcome(
                    key: const ValueKey('claimed'),
                    icon: Icons.check_circle,
                    color: t.accent,
                    text: "You're in! See you there.",
                  ),
                  ClaimStatus.soldOut => _Outcome(
                    key: const ValueKey('soldOut'),
                    icon: Icons.event_busy,
                    color: t.danger,
                    text: 'No spots left for this one.',
                  ),
                  _ => Column(
                    key: const ValueKey('form'),
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text('Claim your spot', style: text.titleMedium),
                      const SizedBox(height: 16),
                      ClaimForm(
                        busy: vm.status == ClaimStatus.claiming,
                        soldOut: vm.spotsLeft == 0 && !invite.isVouch,
                        onSubmit: (name, phone, email) => vm.claim(name: name, phone: phone, email: email),
                      ),
                    ],
                  ),
                },
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _Outcome extends StatelessWidget {
  const _Outcome({super.key, required this.icon, required this.color, required this.text});

  final IconData icon;
  final Color color;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 44, color: color),
          const SizedBox(height: 12),
          Text(text, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium),
        ],
      ),
    );
  }
}
