import 'package:fpdart/fpdart.dart';

import '../api/clients/invite_client.dart';
import '../api/models/invite_models.dart';
import 'request_failure.dart';

/// Wraps every client call so view models get `Either<RequestFailure, T>` instead of exceptions.
class InviteRepository {
  InviteRepository([InviteClient? client]) : _client = client ?? InviteClient();

  final InviteClient _client;

  Future<Either<RequestFailure, InviteDetails>> getInvite(String token, {String? userId}) =>
      attempt(() => _client.getInvite(token, userId: userId));

  Future<Either<RequestFailure, String>> createUser(String name, String phone, String email) =>
      attempt(() => _client.createUser(name, phone, email));

  Future<Either<RequestFailure, ClaimResult>> claim(String token, String userId) =>
      attempt(() => _client.claim(token, userId));

  /// Errors and disconnects surface on the stream; the view model reconnects.
  Stream<Availability> availability(String activityId) => _client.availability(activityId);

  /// Metrics must never break the claim flow, so failures are swallowed.
  Future<void> reportLatency(Availability update, DateTime receivedAt, String? userId) =>
      _client.reportLatency(update, receivedAt, userId).catchError((_) {});
}
