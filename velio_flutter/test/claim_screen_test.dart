import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fpdart/fpdart.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:velio_flutter/core/api/models/invite_models.dart';
import 'package:velio_flutter/core/providers.dart';
import 'package:velio_flutter/core/repositories/request_failure.dart';
import 'package:velio_flutter/views/claim/claim_screen.dart';

import 'fakes.dart';

Future<FakeRepo> pumpClaim(WidgetTester tester, {FakeRepo? repo}) async {
  final fake = repo ?? FakeRepo();
  usePhoneScreen(tester);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [inviteRepo.overrideWithValue(fake), storageService.overrideWithValue(FakeStorage())],
      child: MaterialApp(
        home: ClaimScreen(token: 'tok', invite: fake.details),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return fake;
}

Future<void> fillAndClaim(WidgetTester tester) async {
  await tester.enterText(find.widgetWithText(TextFormField, 'Your name'), 'Guest');
  await tester.enterText(find.widgetWithText(TextFormField, 'Phone'), '+15551234');
  await tester.enterText(find.widgetWithText(TextFormField, 'Email'), 'g@x.com');
  await tester.tap(find.text('Claim my spot'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('shows a vouch invite with live spots, and claims it', (tester) async {
    final repo = await pumpClaim(tester);
    expect(find.text('Booky vouched for you'), findsOneWidget);
    expect(find.text('Sunset Kayaking'), findsOneWidget);
    expect(find.text('4 of 10 left'), findsOneWidget);

    repo.live.add(const Availability(activityId: '11', spotsLeft: 3, version: 2));
    await tester.pumpAndSettle();
    expect(find.text('3 of 10 left'), findsOneWidget);

    repo.claimResponse = right(result(spotsLeft: 3, version: 2));
    await fillAndClaim(tester);
    expect(find.text("You're in! See you there."), findsOneWidget);
  });

  testWidgets('validates the form before claiming', (tester) async {
    final repo = await pumpClaim(tester);
    await tester.tap(find.text('Claim my spot'));
    await tester.pumpAndSettle();
    expect(find.text('Required'), findsNWidgets(3));
    expect(repo.claimedWithUser, isNull);
  });

  testWidgets('shows sold out when the race is lost', (tester) async {
    final repo = FakeRepo()..details = invite(type: 'public');
    await pumpClaim(tester, repo: repo);
    expect(find.text('Booky invited you'), findsOneWidget);
    repo.claimResponse = left(const RequestFailure(message: 'x', statusCode: 409, reason: 'race_lost'));
    await fillAndClaim(tester);
    expect(find.text('Sorry, that spot was just taken.'), findsOneWidget);
    expect(find.text('No spots left for this one.'), findsOneWidget);
  });

  testWidgets('while claiming: the button says so with a spinner and the fields lock', (tester) async {
    final repo = await pumpClaim(tester);
    repo
      ..claimResponse = right(result())
      ..claimGate = Completer();
    await tester.enterText(find.widgetWithText(TextFormField, 'Your name'), 'Guest');
    await tester.enterText(find.widgetWithText(TextFormField, 'Phone'), '+15551234');
    await tester.enterText(find.widgetWithText(TextFormField, 'Email'), 'g@x.com');
    await tester.tap(find.text('Claim my spot'));
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.text('Claiming your spot…'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(tester.widget<TextField>(find.byType(TextField).first).enabled, isFalse);

    repo.claimGate!.complete();
    await tester.pumpAndSettle();
    expect(find.text("You're in! See you there."), findsOneWidget);
  });
}
