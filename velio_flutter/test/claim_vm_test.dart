import 'package:flutter_test/flutter_test.dart';
import 'package:fpdart/fpdart.dart';
import 'package:velio_flutter/core/api/models/invite_models.dart';
import 'package:velio_flutter/core/repositories/request_failure.dart';
import 'package:velio_flutter/core/view_models/claim_vm.dart';
import 'package:velio_flutter/core/view_models/invite_entry_vm.dart';

import 'fakes.dart';

void main() {
  late FakeRepo repo;
  late FakeStorage storage;
  late ClaimVM vm;
  late List<String> bounced;

  setUp(() {
    repo = FakeRepo();
    storage = FakeStorage();
    bounced = [];
    vm = ClaimVM(repo, storage, onInviteUnusable: bounced.add);
  });
  tearDown(() => vm.dispose());

  test('start shows the checked invite and its live count without fetching it again', () async {
    await vm.start('tok', invite());
    expect(vm.status, ClaimStatus.ready);
    expect(vm.invite!.inviterName, 'Booky');
    expect(vm.spotsLeft, 4);
    expect(repo.getInviteCalls, 0); // invite_opened is counted once, by the invite page
  });

  test('live updates apply only when newer, and committed ones report latency', () async {
    await vm.start('tok', invite());
    repo.live.add(Availability(activityId: '11', spotsLeft: 3, version: 2, committedAt: DateTime.now()));
    await pumpEventQueue();
    expect(vm.spotsLeft, 3);

    repo.live.add(const Availability(activityId: '11', spotsLeft: 9, version: 1)); // stale
    await pumpEventQueue();
    expect(vm.spotsLeft, 3);
    expect(repo.reported.map((u) => u.version), [2]);
  });

  test('claim creates the identity once, stores it, and succeeds', () async {
    await vm.start('tok', invite());
    repo.claimResponse = right(result());
    await vm.claim(name: 'Guest', phone: '+15551234', email: 'g@x.com');
    expect(vm.status, ClaimStatus.claimed);
    expect(repo.createdUsers, ['Guest']);
    expect(repo.claimedWithUser, '42');
    expect(storage.id, '42');
    expect(vm.message, isNull);
  });

  test('released vouch: explains the open-spot fallback', () async {
    await vm.start('tok', invite());
    repo.claimResponse = right(result(source: 'open', spotsLeft: 2, version: 3));
    await vm.claim(name: 'Guest', phone: '+15551234', email: 'g@x.com');
    expect(vm.status, ClaimStatus.claimed);
    expect(vm.spotsLeft, 2);
    expect(vm.message, contains('open spot'));
  });

  test('race lost: sold out, with a plain message', () async {
    await vm.start('tok', invite());
    repo.claimResponse = left(const RequestFailure(message: 'x', statusCode: 409, reason: 'race_lost'));
    await vm.claim(name: 'Guest', phone: '+15551234', email: 'g@x.com');
    expect(vm.status, ClaimStatus.soldOut);
    expect(vm.message, 'Sorry, that spot was just taken.');
  });

  test('vouch used up before the claim: sends the guest back to the invite page', () async {
    await vm.start('tok', invite());
    repo.claimResponse = left(const RequestFailure(message: 'x', statusCode: 409, reason: 'used'));
    await vm.claim(name: 'Guest', phone: '+15551234', email: 'g@x.com');
    expect(bounced, [usedVouchMessage]);
    expect(vm.message, isNull); // nothing shown on the claim page
  });

  test('duplicate claims explain themselves on the claim page', () async {
    await vm.start('tok', invite());
    repo.claimResponse = left(const RequestFailure(message: 'x', statusCode: 409, reason: 'duplicate'));
    await vm.claim(name: 'Guest', phone: '+15551234', email: 'g@x.com');
    await vm.claim(name: 'Guest', phone: '+15551234', email: 'g@x.com');
    expect(vm.message, 'You already have a spot for this activity.');
    expect(repo.createdUsers, ['Guest']); // identity reused from storage
    expect(bounced, isEmpty);
  });
}
