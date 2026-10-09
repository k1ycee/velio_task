import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fpdart/fpdart.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:velio_flutter/core/providers.dart';
import 'package:velio_flutter/core/repositories/request_failure.dart';
import 'package:velio_flutter/core/view_models/invite_entry_vm.dart';
import 'package:velio_flutter/core/view_models/my_activities_vm.dart';
import 'package:velio_flutter/widgets/activity_cover.dart';
import 'package:velio_flutter/utils/format_when.dart';
import 'package:velio_flutter/views/controller/controller_screen.dart';
import 'package:velio_flutter/widgets/skeleton.dart';

import 'fakes.dart';

void main() {
  final now = DateTime.utc(2026, 10, 8, 12);
  final yesterday = now.subtract(const Duration(days: 1));
  final lastWeek = now.subtract(const Duration(days: 7));
  final tomorrow = now.add(const Duration(days: 1));
  final nextWeek = now.add(const Duration(days: 7));

  group('MyActivitiesVM', () {
    test('a guest with no saved identity has nothing yet, without calling the server', () async {
      final repo = FakeActivityRepo();
      final vm = MyActivitiesVM(repo, FakeStorage(), now: () => now);
      await vm.load();
      expect(vm.status, MyActivitiesStatus.ready);
      expect(vm.upcoming, isEmpty);
      expect(repo.askedFor, isNull);
    });

    test('splits upcoming (soonest first) from past (most recent first)', () async {
      final repo = FakeActivityRepo()
        ..response = right([
          mine('Last week', lastWeek),
          mine('Yesterday', yesterday),
          mine('Tomorrow', tomorrow),
          mine('Next week', nextWeek),
        ]);
      final vm = MyActivitiesVM(repo, FakeStorage()..id = '42', now: () => now);
      await vm.load();
      expect(repo.askedFor, '42');
      expect(vm.upcoming.map((a) => a.activity.title), ['Tomorrow', 'Next week']);
      expect(vm.past.map((a) => a.activity.title), ['Yesterday', 'Last week']);
    });

    test('a failed reload keeps the list it already had', () async {
      final repo = FakeActivityRepo()..response = right([mine('Tomorrow', tomorrow)]);
      final vm = MyActivitiesVM(repo, FakeStorage()..id = '42', now: () => now);
      await vm.load();
      repo.response = left(const RequestFailure(message: "Can't reach Velio. Check your connection."));
      await vm.load();
      expect(vm.status, MyActivitiesStatus.error);
      expect(vm.upcoming, hasLength(1));
      expect(vm.message, contains("Can't reach Velio"));
    });
  });

  testWidgets('the second tab lists my activities with their dates and who booked them', (tester) async {
    final soon = DateTime.now().add(const Duration(days: 2));
    final activities = FakeActivityRepo()
      ..response = right([
        mine('Sunset Kayaking', soon),
        mine('Board games', soon.add(const Duration(days: 1)), role: 'booker'),
      ]);
    late ProviderContainer container;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          inviteRepo.overrideWithValue(FakeRepo()),
          activityRepo.overrideWithValue(activities),
          storageService.overrideWithValue(FakeStorage()..id = '42'),
        ],
        child: Consumer(
          builder: (context, ref, _) {
            container = ProviderScope.containerOf(context);
            return MaterialApp(navigatorKey: ref.read(navigationService).navigatorKey, home: const ControllerScreen());
          },
        ),
      ),
    );

    expect(find.text('Got an invite?'), findsOneWidget);
    await tester.tap(find.text('My activities'));
    await tester.pumpAndSettle();

    expect(find.text('Upcoming'), findsOneWidget);
    expect(find.text('Sunset Kayaking'), findsOneWidget);
    final l10n = MaterialLocalizations.of(tester.element(find.text('Sunset Kayaking')));
    expect(find.text(formatWhen(l10n, soon)), findsOneWidget); // same short form as the web
    expect(find.textContaining('With Bo'), findsOneWidget);
    expect(find.textContaining('You booked this'), findsOneWidget);
    expect(find.byType(ActivityCover), findsNWidgets(2)); // a gradient cover per card, like the web

    // A used invite tapped while on this tab brings the guest back to the invite tab for the flashbar.
    container.read(inviteEntryVM).bounce(usedVouchMessage);
    await tester.pump();
    expect(find.text('Got an invite?'), findsOneWidget);
    expect(find.text(usedVouchMessage), findsOneWidget);
    await tester.pumpAndSettle(); // let the flashbar finish
  });

  testWidgets('first load shows skeleton cards (after a short delay) instead of a spinner', (tester) async {
    final activities = FakeActivityRepo()..gate = Completer();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          inviteRepo.overrideWithValue(FakeRepo()),
          activityRepo.overrideWithValue(activities),
          storageService.overrideWithValue(FakeStorage()..id = '42'),
        ],
        child: Consumer(
          builder: (_, ref, _) =>
              MaterialApp(navigatorKey: ref.read(navigationService).navigatorKey, home: const ControllerScreen()),
        ),
      ),
    );
    await tester.tap(find.text('My activities'));
    await tester.pump();

    final fade = find.descendant(of: find.byType(Skeleton), matching: find.byType(FadeTransition)).first;
    expect(tester.widget<FadeTransition>(fade).opacity.value, 0); // a fast load never flashes it
    await tester.pump(const Duration(milliseconds: 200));
    expect(tester.widget<FadeTransition>(fade).opacity.value, 1);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.bySemanticsLabel('Loading your activities'), findsOneWidget);

    activities
      ..response = right([mine('Sunset Kayaking', DateTime.now().add(const Duration(days: 2)))])
      ..gate!.complete();
    await tester.pumpAndSettle();
    expect(find.byType(Skeleton), findsNothing);
    expect(find.text('Sunset Kayaking'), findsOneWidget);
  });
}
