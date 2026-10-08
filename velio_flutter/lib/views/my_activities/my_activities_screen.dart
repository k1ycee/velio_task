import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../core/api/models/my_activity_model.dart';
import '../../core/constants/velio_theme.dart';
import '../../core/providers.dart';
import '../../core/view_models/my_activities_vm.dart';
import '../../utils/format_when.dart';
import '../../widgets/skeleton.dart';
import '../../widgets/surfaces.dart';

/// Every activity the guest booked or claimed, with its date. Pull down to refresh.
class MyActivitiesScreen extends ConsumerWidget {
  const MyActivitiesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vm = ref.watch(myActivitiesVM);
    final text = Theme.of(context).textTheme;
    final error = vm.message == null
        ? null
        : Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Notice(
              vm.message!,
              tone: NoticeTone.error,
              action: TextButton(onPressed: vm.load, child: const Text('Retry')),
            ),
          );

    final List<Widget> children = switch (vm.status) {
      MyActivitiesStatus.loading => const [
        Skeleton(
          label: 'Loading your activities',
          child: Column(children: [_SkeletonRow(), _SkeletonRow(), _SkeletonRow()]),
        ),
      ],
      _ when vm.upcoming.isEmpty && vm.past.isEmpty => [?error, if (error == null) const _Empty()],
      _ => [
        ?error,
        if (vm.upcoming.isNotEmpty) ...[
          Text('Upcoming', style: text.titleMedium),
          for (final a in vm.upcoming) _ActivityRow(item: a),
          const SizedBox(height: 24),
        ],
        if (vm.past.isNotEmpty) ...[
          Text('Past', style: text.titleMedium),
          for (final a in vm.past) _ActivityRow(item: a, past: true),
        ],
      ],
    };

    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: vm.load,
          child: ListView(
            padding: const EdgeInsets.all(20),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              const PageHeader(title: 'My activities'),
              ...children,
            ],
          ),
        ),
      ),
    );
  }
}

/// Web `.list > li.row`: surface, 1px border, 10px radius; bold title over a muted date.
class _ActivityRow extends StatelessWidget {
  const _ActivityRow({required this.item, this.past = false});

  final MyActivity item;
  final bool past;

  @override
  Widget build(BuildContext context) {
    final t = VelioTokens.of(context);
    final l10n = MaterialLocalizations.of(context);
    final when = formatWhen(l10n, item.activity.startsAt);

    return Card(
      margin: const EdgeInsets.only(top: 8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.activity.title,
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(color: past ? t.muted : null),
                  ),
                  const SizedBox(height: 2),
                  Text(when, style: TextStyle(color: t.muted)),
                  const SizedBox(height: 2),
                  Text(
                    item.isBooker ? 'You booked this' : 'With ${item.bookerName}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
            if (item.isBooker) const VelioBadge('booker') else const VelioBadge('guest'),
          ],
        ),
      ),
    );
  }
}

/// Same shape as [_ActivityRow]: title, date line, "with" line, badge.
class _SkeletonRow extends StatelessWidget {
  const _SkeletonRow();

  @override
  Widget build(BuildContext context) {
    return const Card(
      margin: EdgeInsets.only(top: 8),
      child: Padding(
        padding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SkeletonBox(width: 160, height: 16),
                  SizedBox(height: 8),
                  SkeletonBox(width: 220, height: 12),
                  SizedBox(height: 6),
                  SkeletonBox(width: 90, height: 12),
                ],
              ),
            ),
            SkeletonBox(width: 52, height: 18, radius: 999),
          ],
        ),
      ),
    );
  }
}

/// Web `.empty`: one muted line, no illustration.
class _Empty extends StatelessWidget {
  const _Empty();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Text(
        'No activities yet. Claim an invite and it will show up here.',
        style: TextStyle(color: VelioTokens.of(context).muted),
      ),
    );
  }
}
