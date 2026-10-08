import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fpdart/fpdart.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:velio_flutter/core/providers.dart';
import 'package:velio_flutter/core/repositories/request_failure.dart';
import 'package:velio_flutter/core/view_models/invite_entry_vm.dart';
import 'package:velio_flutter/views/claim/claim_screen.dart';
import 'package:velio_flutter/views/home/home_screen.dart';
import 'package:velio_flutter/views/home/widget/flash_bar.dart';

import 'fakes.dart';

Future<void> pumpHome(WidgetTester tester, FakeRepo repo) async {
  await tester.pumpWidget(ProviderScope(
    overrides: [
      inviteRepo.overrideWithValue(repo),
      storageService.overrideWithValue(FakeStorage()),
    ],
    child: Consumer(
      builder: (_, ref, _) => MaterialApp(navigatorKey: ref.read(navigationService).navigatorKey, home: const HomeScreen()),
    ),
  ));
}

/// Pumps fixed steps instead of pumpAndSettle, which would run the flashbar's whole 2.5s animation.
Future<void> pumpBriefly(WidgetTester tester) async {
  for (var i = 0; i < 5; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Future<void> openInvite(WidgetTester tester, String code) async {
  await tester.enterText(find.byType(TextField), code);
  await tester.tap(find.text('Open invite'));
  await pumpBriefly(tester);
}

/// The flashbar is fully on screen (its top edge at the top of the page body).
bool flashBarShown(WidgetTester tester) =>
    tester.getTopLeft(find.descendant(of: find.byType(FlashBar), matching: find.byType(Material))).dy ==
    tester.getTopLeft(find.byType(Stack).first).dy;

void main() {
  testWidgets('a used vouch link shows a flashbar on the invite page and does not open the claim page',
      (tester) async {
    await pumpHome(tester, FakeRepo()..details = invite(used: true));
    await openInvite(tester, 'velio://invite/usedtoken1');

    expect(find.byType(ClaimScreen), findsNothing);
    expect(find.text('Got an invite?'), findsOneWidget);
    expect(find.widgetWithText(FlashBar, usedVouchMessage), findsOneWidget);
    expect(flashBarShown(tester), isTrue); // dropped in

    await tester.pump(FlashBar.hold); // held for 2s, now sliding back up
    expect(flashBarShown(tester), isFalse);
    await tester.pumpAndSettle();
    expect(find.byType(FlashBar), findsNothing); // gone by itself
  });

  testWidgets('a vouch used up while claiming returns to the invite page with the flashbar', (tester) async {
    final repo = FakeRepo();
    await pumpHome(tester, repo);
    await openInvite(tester, 'freshtoken1');
    await tester.pumpAndSettle(); // finish the page transition
    expect(find.text('Booky vouched for you'), findsOneWidget);

    repo.claimResponse = left(const RequestFailure(message: 'x', statusCode: 409, reason: 'used'));
    await tester.enterText(find.widgetWithText(TextFormField, 'Your name'), 'Guest');
    await tester.enterText(find.widgetWithText(TextFormField, 'Phone'), '+15551234');
    await tester.enterText(find.widgetWithText(TextFormField, 'Email'), 'g@x.com');
    await tester.tap(find.text('Claim my spot'));
    await pumpBriefly(tester);

    expect(find.widgetWithText(FlashBar, usedVouchMessage), findsOneWidget);
    await tester.pumpAndSettle();
    expect(find.byType(ClaimScreen), findsNothing);
    expect(find.byType(FlashBar), findsNothing);
  });
}
