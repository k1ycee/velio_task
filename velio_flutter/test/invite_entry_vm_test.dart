import 'package:flutter_test/flutter_test.dart';
import 'package:velio_flutter/core/view_models/invite_entry_vm.dart';

import 'fakes.dart';

void main() {
  late FakeRepo repo;
  late FakeNav nav;
  late InviteEntryVM vm;

  setUp(() {
    repo = FakeRepo();
    nav = FakeNav();
    vm = InviteEntryVM(repo, FakeStorage()..id = '5', nav);
  });

  test('a claimable invite opens the claim page, passing the known user', () async {
    await vm.open('tok');
    expect(nav.opened!.inviterName, 'Booky');
    expect(repo.openedWithUser, '5');
    expect(vm.flash, isNull);
    expect(vm.opening, isFalse);
  });

  test('a used vouch link stays on this page with a flashbar', () async {
    repo.details = invite(used: true);
    await vm.open('tok');
    expect(nav.opened, isNull);
    expect(vm.flash, usedVouchMessage);
  });

  test('an unknown invite stays on this page with a flashbar', () async {
    await vm.open('missing');
    expect(nav.opened, isNull);
    expect(vm.flash, "That invite link doesn't exist.");
  });

  test('bounce returns to this page; the next attempt clears the flashbar', () async {
    vm.bounce(usedVouchMessage);
    expect(nav.backToHomeCalls, 1);
    expect(vm.flash, usedVouchMessage);
    await vm.open('tok');
    expect(vm.flash, isNull);
  });
}
