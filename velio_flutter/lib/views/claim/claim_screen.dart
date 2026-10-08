import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../core/api/models/invite_models.dart';
import '../../core/providers.dart';
import '../../core/view_models/claim_vm.dart';
import 'widget/claim_form.dart';
import 'widget/spots_left_chip.dart';

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
      appBar: AppBar(title: const Text('Your invite')),
      body: SafeArea(
        child: switch (vm.status) {
          ClaimStatus.loading => const Center(child: CircularProgressIndicator()),
          _ => _Invite(vm: vm),
        },
      ),
    );
  }
}

class _Invite extends StatelessWidget {
  const _Invite({required this.vm});

  final ClaimVM vm;

  @override
  Widget build(BuildContext context) {
    final invite = vm.invite!;
    final text = Theme.of(context).textTheme;
    final when = MaterialLocalizations.of(context);
    final startsAt = invite.activity.startsAt.toLocal();

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text(
          invite.isVouch ? '${invite.inviterName} vouched for you' : '${invite.inviterName} invited you',
          style: text.titleMedium?.copyWith(color: Theme.of(context).colorScheme.primary),
        ),
        const SizedBox(height: 8),
        Text(invite.activity.title, style: text.headlineSmall),
        const SizedBox(height: 4),
        Text('${when.formatFullDate(startsAt)} · ${when.formatTimeOfDay(TimeOfDay.fromDateTime(startsAt))}'),
        const SizedBox(height: 16),
        Align(alignment: Alignment.centerLeft, child: SpotsLeftChip(spotsLeft: vm.spotsLeft, capacity: invite.activity.capacity)),
        if (invite.isVouch) ...[
          const SizedBox(height: 12),
          const Text('A spot is being held for you.'),
        ],
        const SizedBox(height: 24),
        if (vm.message != null) ...[
          _Banner(text: vm.message!, isError: vm.status != ClaimStatus.claimed),
          const SizedBox(height: 16),
        ],
        switch (vm.status) {
          ClaimStatus.claimed => const _Message(icon: Icons.check_circle, text: "You're in! See you there."),
          ClaimStatus.soldOut => const _Message(icon: Icons.event_busy, text: 'No spots left for this one.'),
          _ => ClaimForm(
              busy: vm.status == ClaimStatus.claiming,
              soldOut: vm.spotsLeft == 0 && !invite.isVouch,
              onSubmit: (name, phone, email) => vm.claim(name: name, phone: phone, email: email),
            ),
        },
      ],
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.text, required this.isError});

  final String text;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isError ? scheme.errorContainer : scheme.secondaryContainer,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(text, style: TextStyle(color: isError ? scheme.onErrorContainer : scheme.onSecondaryContainer)),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 48, color: Theme.of(context).colorScheme.primary),
          const SizedBox(height: 12),
          Text(text, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium),
        ],
      ),
    );
  }
}
