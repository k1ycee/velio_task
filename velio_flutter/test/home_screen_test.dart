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

Future<void> openInvite(WidgetTester tester, String code) async {
  await tester.enterText(find.byType(TextField), code);
  await tester.tap(find.text('Open invite'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a used vouch link shows a flashbar on the invite page and does not open the claim page',
      (tester) async {
    await pumpHome(tester, FakeRepo()..details = invite(used: true));
    await openInvite(tester, 'velio://invite/usedtoken1');

    expect(find.byType(ClaimScreen), findsNothing);
    expect(find.text('Got an invite?'), findsOneWidget);
    expect(find.widgetWithText(FlashBar, usedVouchMessage), findsOneWidget);

    await tester.tap(find.byTooltip('Dismiss'));
    await tester.pump();
    expect(find.byType(FlashBar), findsNothing);
  });

  testWidgets('a vouch used up while claiming returns to the invite page with the flashbar', (tester) async {
    final repo = FakeRepo();
    await pumpHome(tester, repo);
    await openInvite(tester, 'freshtoken1');
    expect(find.text('Booky vouched for you'), findsOneWidget);

    repo.claimResponse = left(const RequestFailure(message: 'x', statusCode: 409, reason: 'used'));
    await tester.enterText(find.widgetWithText(TextFormField, 'Your name'), 'Guest');
    await tester.enterText(find.widgetWithText(TextFormField, 'Phone'), '+15551234');
    await tester.enterText(find.widgetWithText(TextFormField, 'Email'), 'g@x.com');
    await tester.tap(find.text('Claim my spot'));
    await tester.pumpAndSettle();

    expect(find.byType(ClaimScreen), findsNothing);
    expect(find.widgetWithText(FlashBar, usedVouchMessage), findsOneWidget);
  });
}
