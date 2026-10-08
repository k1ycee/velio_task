import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../core/api/models/my_activity_model.dart';
import '../../core/providers.dart';
import '../../core/view_models/my_activities_vm.dart';
import '../../widgets/skeleton.dart';

/// Every activity the guest booked or claimed, with its date. Pull down to refresh.
class MyActivitiesScreen extends ConsumerWidget {
  const MyActivitiesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vm = ref.watch(myActivitiesVM);
    final text = Theme.of(context).textTheme;

    final List<Widget> children = switch (vm.status) {
      MyActivitiesStatus.loading => const [
        Skeleton(
          label: 'Loading your activities',
          child: Column(children: [_SkeletonTile(), _SkeletonTile(), _SkeletonTile()]),
        ),
      ],
      _ when vm.upcoming.isEmpty && vm.past.isEmpty => [
        if (vm.message != null) _Error(message: vm.message!, onRetry: vm.load) else const _Empty(),
      ],
      _ => [
        if (vm.message != null) _Error(message: vm.message!, onRetry: vm.load),
        if (vm.upcoming.isNotEmpty) ...[
          Text('Upcoming', style: text.titleMedium),
          for (final a in vm.upcoming) _ActivityTile(item: a),
          const SizedBox(height: 16),
        ],
        if (vm.past.isNotEmpty) ...[
          Text('Past', style: text.titleMedium),
          for (final a in vm.past) _ActivityTile(item: a, past: true),
        ],
      ],
    };

    return Scaffold(
      appBar: AppBar(title: const Text('My activities')),
      body: RefreshIndicator(
        onRefresh: vm.load,
        child: ListView(
          padding: const EdgeInsets.all(20),
          physics: const AlwaysScrollableScrollPhysics(),
          children: children,
        ),
      ),
    );
  }
}

class _ActivityTile extends StatelessWidget {
  const _ActivityTile({required this.item, this.past = false});

  final MyActivity item;
  final bool past;

  @override
  Widget build(BuildContext context) {
    final l10n = MaterialLocalizations.of(context);
    final startsAt = item.activity.startsAt.toLocal();
    final when = '${l10n.formatFullDate(startsAt)} · ${l10n.formatTimeOfDay(TimeOfDay.fromDateTime(startsAt))}';
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;

    return Card(
      margin: const EdgeInsets.only(top: 8),
      child: ListTile(
        leading: Icon(past ? Icons.event_available : Icons.event, color: past ? muted : null),
        title: Text(item.activity.title, style: past ? TextStyle(color: muted) : null),
        subtitle: Text('$when\n${item.isBooker ? 'You booked this' : 'With ${item.bookerName}'}'),
        isThreeLine: true,
      ),
    );
  }
}

/// Same shape as [_ActivityTile]: icon, title, date line, "with" line.
class _SkeletonTile extends StatelessWidget {
  const _SkeletonTile();

  @override
  Widget build(BuildContext context) {
    return const Card(
      margin: EdgeInsets.only(top: 8),
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 14, 16, 14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SkeletonBox(width: 24, height: 24, radius: 12),
            SizedBox(width: 16),
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
          ],
        ),
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 48),
      child: Column(
        children: [
          Icon(Icons.event_note, size: 48, color: Theme.of(context).colorScheme.primary),
          const SizedBox(height: 12),
          Text('No activities yet', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          const Text('Claim an invite and it will show up here.', textAlign: TextAlign.center),
        ],
      ),
    );
  }
}

class _Error extends StatelessWidget {
  const _Error({required this.message, required this.onRetry});

  final String message;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: scheme.errorContainer,
      child: ListTile(
        title: Text(message, style: TextStyle(color: scheme.onErrorContainer)),
        trailing: TextButton(onPressed: onRetry, child: const Text('Retry')),
      ),
    );
  }
}
