import 'package:flutter_test/flutter_test.dart';
import 'package:fpdart/fpdart.dart';
import 'package:velio_flutter/core/api/models/invite_models.dart';
import 'package:velio_flutter/core/repositories/request_failure.dart';
import 'package:velio_flutter/core/view_models/claim_vm.dart';

import 'fakes.dart';

void main() {
  late FakeRepo repo;
  late FakeStorage storage;
  late ClaimVM vm;

  setUp(() {
    repo = FakeRepo();
    storage = FakeStorage();
    vm = ClaimVM(repo, storage);
  });
  tearDown(() => vm.dispose());

  test('open loads the invite and its live count, passing the known user', () async {
    storage.id = '5';
    await vm.open('tok');
    expect(vm.status, ClaimStatus.ready);
    expect(vm.invite!.inviterName, 'Booky');
    expect(vm.spotsLeft, 4);
    expect(repo.openedWithUser, '5');
  });

  test('open shows an error for an unknown invite', () async {
    await vm.open('missing');
    expect(vm.status, ClaimStatus.error);
    expect(vm.message, 'invite not found');
  });

  test('live updates apply only when newer, and committed ones report latency', () async {
    await vm.open('tok');
    repo.live.add(Availability(activityId: '11', spotsLeft: 3, version: 2, committedAt: DateTime.now()));
    await pumpEventQueue();
    expect(vm.spotsLeft, 3);

    repo.live.add(const Availability(activityId: '11', spotsLeft: 9, version: 1)); // stale
    await pumpEventQueue();
    expect(vm.spotsLeft, 3);
    expect(repo.reported.map((u) => u.version), [2]);
  });

  test('claim creates the identity once, stores it, and succeeds', () async {
    await vm.open('tok');
    repo.claimResponse = right(result());
    await vm.claim(name: 'Guest', phone: '+15551234', email: 'g@x.com');
    expect(vm.status, ClaimStatus.claimed);
    expect(repo.createdUsers, ['Guest']);
    expect(repo.claimedWithUser, '42');
    expect(storage.id, '42');
    expect(vm.message, isNull);
  });

  test('released vouch: explains the open-spot fallback', () async {
    await vm.open('tok');
    repo.claimResponse = right(result(source: 'open', spotsLeft: 2, version: 3));
    await vm.claim(name: 'Guest', phone: '+15551234', email: 'g@x.com');
    expect(vm.status, ClaimStatus.claimed);
    expect(vm.spotsLeft, 2);
    expect(vm.message, contains('open spot'));
  });

  test('race lost: sold out, with a plain message', () async {
    await vm.open('tok');
    repo.claimResponse = left(const RequestFailure(message: 'x', statusCode: 409, reason: 'race_lost'));
    await vm.claim(name: 'Guest', phone: '+15551234', email: 'g@x.com');
    expect(vm.status, ClaimStatus.soldOut);
    expect(vm.message, 'Sorry, that spot was just taken.');
  });

  test('used vouch and duplicate claims get their own messages', () async {
    await vm.open('tok');
    repo.claimResponse = left(const RequestFailure(message: 'x', statusCode: 409, reason: 'used'));
    await vm.claim(name: 'Guest', phone: '+15551234', email: 'g@x.com');
    expect(vm.message, 'This vouch link has already been used.');
    expect(vm.status, ClaimStatus.ready);

    repo.claimResponse = left(const RequestFailure(message: 'x', statusCode: 409, reason: 'duplicate'));
    await vm.claim(name: 'Guest', phone: '+15551234', email: 'g@x.com');
    expect(vm.message, 'You already have a spot for this activity.');
    expect(repo.createdUsers, ['Guest']); // identity reused from storage
  });
}
