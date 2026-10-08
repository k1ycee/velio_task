import 'dart:async';

import 'package:fpdart/fpdart.dart';
import 'package:velio_flutter/core/api/models/invite_models.dart';
import 'package:velio_flutter/core/api/models/my_activity_model.dart';
import 'package:velio_flutter/core/repositories/activity_repo.dart';
import 'package:velio_flutter/core/repositories/invite_repo.dart';
import 'package:velio_flutter/core/repositories/request_failure.dart';
import 'package:velio_flutter/core/services/navigation_service.dart';
import 'package:velio_flutter/core/services/storage_service.dart';

InviteDetails invite({String type = 'vouch', bool used = false, int spotsLeft = 4, int version = 1}) =>
    InviteDetails.fromJson({
      'inviteId': '7',
      'type': type,
      'label': 'Ada',
      'used': used,
      'planId': '3',
      'inviterName': 'Booky',
      'activity': {
        'id': '11',
        'title': 'Sunset Kayaking',
        'startsAt': '2026-10-09T18:00:00.000Z',
        'capacity': 10,
        'spotsLeft': spotsLeft,
        'version': version,
      },
    });

class FakeRepo implements InviteRepository {
  InviteDetails details = invite();
  Either<RequestFailure, ClaimResult>? claimResponse;

  /// When set, invite lookups wait for it, so tests can look at the "checking" state.
  Completer<void>? inviteGate;

  /// When set, claims wait for it, so tests can look at the in-flight state.
  Completer<void>? claimGate;
  final live = StreamController<Availability>.broadcast();
  final reported = <Availability>[];
  final createdUsers = <String>[];
  String? openedWithUser;
  int getInviteCalls = 0;
  String? claimedWithUser;

  @override
  Future<Either<RequestFailure, InviteDetails>> getInvite(String token, {String? userId}) async {
    openedWithUser = userId;
    getInviteCalls++;
    await inviteGate?.future;
    return token == 'missing'
        ? left(const RequestFailure(message: 'invite not found', statusCode: 404))
        : right(details);
  }

  @override
  Future<Either<RequestFailure, String>> createUser(String name, String phone, String email) async {
    createdUsers.add(name);
    return right('42');
  }

  @override
  Future<Either<RequestFailure, ClaimResult>> claim(String token, String userId) async {
    claimedWithUser = userId;
    await claimGate?.future;
    return claimResponse!;
  }

  @override
  Stream<Availability> availability(String activityId) => live.stream;

  @override
  Future<void> reportLatency(Availability update, DateTime receivedAt, String? userId) async => reported.add(update);
}

class FakeStorage implements StorageService {
  String? id;
  @override
  Future<String?> userId() async => id;
  @override
  Future<void> saveUserId(String value) async => id = value;
}

ClaimResult result({String source = 'held', int spotsLeft = 4, int version = 1}) => ClaimResult.fromJson({
  'spotId': '99',
  'planId': '3',
  'activityId': '11',
  'source': source,
  'spotsLeft': spotsLeft,
  'version': version,
});

class FakeNav extends NavigationService {
  InviteDetails? opened;
  int backToHomeCalls = 0;
  @override
  void openClaim(String token, InviteDetails invite) => opened = invite;
  @override
  void backToHome() => backToHomeCalls++;
}

MyActivity mine(String title, DateTime startsAt, {String role = 'guest', String bookerName = 'Bo'}) =>
    MyActivity.fromJson({
      'planId': '3',
      'role': role,
      'bookerName': bookerName,
      'activity': {
        'id': title,
        'title': title,
        'startsAt': startsAt.toUtc().toIso8601String(),
        'capacity': 6,
        'spotsLeft': 2,
        'version': 1,
      },
    });

class FakeActivityRepo implements ActivityRepository {
  Either<RequestFailure, List<MyActivity>> response = right(const []);
  String? askedFor;

  /// When set, loads wait for it, so tests can look at the loading state.
  Completer<void>? gate;

  @override
  Future<Either<RequestFailure, List<MyActivity>>> myActivities(String userId) async {
    askedFor = userId;
    await gate?.future;
    return response;
  }
}
