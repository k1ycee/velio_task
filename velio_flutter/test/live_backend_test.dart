// Runs the real client → repository → view model against a local velio_server.
// Skipped automatically when the server isn't running (start it with `npm run start` in velio_server).
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:velio_flutter/core/api/urls.dart';
import 'package:velio_flutter/core/repositories/invite_repo.dart';
import 'package:velio_flutter/core/view_models/claim_vm.dart';
import 'package:velio_flutter/core/view_models/invite_entry_vm.dart';

import 'fakes.dart';

Future<bool> serverUp() async {
  try {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 1);
    final res = await (await client.getUrl(Uri.parse('$apiUrl/activities'))).close();
    client.close(force: true);
    return res.statusCode == 200;
  } catch (_) {
    return false;
  }
}

Future<void> waitFor(bool Function() done, {Duration timeout = const Duration(seconds: 2)}) async {
  final deadline = DateTime.now().add(timeout);
  while (!done()) {
    if (DateTime.now().isAfter(deadline)) throw StateError('timed out after $timeout');
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }
}

void main() async {
  final up = await serverUp();
  final dio = Dio(BaseOptions(baseUrl: apiUrl));
  var n = DateTime.now().microsecondsSinceEpoch;

  Future<String> user(String name) async {
    n++;
    final res = await dio.post<Map<String, dynamic>>('/users',
        data: {'name': name, 'phone': '+1$n', 'email': 'f$n@flutter.test'});
    return res.data!['id'] as String;
  }

  Options as(String id) => Options(headers: {'X-User-Id': id});

  test('vouch invite: opens, updates live within 2s, and claims the held spot', () async {
    final host = await user('Host');
    final activity = await dio.post<Map<String, dynamic>>('/activities', options: as(host), data: {
      'title': 'Flutter Live',
      'startsAt': DateTime.now().add(const Duration(days: 2)).toUtc().toIso8601String(),
      'capacity': 6,
    });
    final activityId = activity.data!['id'] as String;
    final booker = await user('Booky');
    final booking = await dio.post<Map<String, dynamic>>('/bookings',
        options: as(booker), data: {'activityId': activityId, 'heldSpots': 1});
    final invite = await dio.post<Map<String, dynamic>>('/plans/${booking.data!['planId']}/invites',
        options: as(booker), data: {'type': 'vouch', 'label': 'Guest'});

    final token = invite.data!['token'] as String;
    final nav = FakeNav();
    final entry = InviteEntryVM(InviteRepository(), FakeStorage(), nav);
    await entry.open(token);
    final vm = ClaimVM(InviteRepository(), FakeStorage(), onInviteUnusable: entry.bounce);
    addTearDown(vm.dispose);
    await vm.start(token, nav.opened!);
    expect(vm.status, ClaimStatus.ready);
    expect(vm.invite!.isVouch, isTrue);
    expect(vm.spotsLeft, 4);

    // Someone else books; the guest's screen updates over SSE.
    final other = await user('Other');
    final started = DateTime.now();
    await dio.post<void>('/bookings', options: as(other), data: {'activityId': activityId, 'heldSpots': 0});
    await waitFor(() => vm.spotsLeft == 3);
    expect(DateTime.now().difference(started).inMilliseconds, lessThan(2000));

    await vm.claim(name: 'Guest', phone: '+1${++n}', email: 'g$n@flutter.test');
    expect(vm.status, ClaimStatus.claimed);
    expect(vm.message, isNull); // came from the held spot, no fallback

    // Opening the same vouch link again is stopped on the invite page.
    nav.opened = null;
    await entry.open(token);
    expect(nav.opened, isNull);
    expect(entry.flash, usedVouchMessage);
  }, skip: up ? false : 'velio_server not running at $apiUrl');
}
