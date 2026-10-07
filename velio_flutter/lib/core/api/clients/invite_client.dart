import 'dart:convert';

import 'package:dio/dio.dart';

import '../../../utils/sse.dart';
import '../models/invite_models.dart';
import '../urls.dart';

/// Thin Dio wrapper over the invite endpoints. Throws on failure; the repository translates.
class InviteClient {
  InviteClient([Dio? dio]) : _dio = dio ?? Dio(BaseOptions(baseUrl: apiUrl, connectTimeout: const Duration(seconds: 10)));

  final Dio _dio;

  Options _as(String? userId) => Options(headers: {'X-User-Id': ?userId});

  Future<InviteDetails> getInvite(String token, {String? userId}) async {
    final res = await _dio.get<Map<String, dynamic>>(Urls.invite(token), options: _as(userId));
    return InviteDetails.fromJson(res.data!);
  }

  /// Returns the user's id; the server returns the existing user if the phone or email matches.
  Future<String> createUser(String name, String phone, String email) async {
    final res = await _dio.post<Map<String, dynamic>>(Urls.users, data: {'name': name, 'phone': phone, 'email': email});
    return res.data!['id'] as String;
  }

  Future<ClaimResult> claim(String token, String userId) async {
    final res = await _dio.post<Map<String, dynamic>>(Urls.claim(token), data: <String, dynamic>{}, options: _as(userId));
    return ClaimResult.fromJson(res.data!);
  }

  /// Snapshot first, then every committed change, until the connection drops.
  Stream<Availability> availability(String activityId) async* {
    final res = await _dio.get<ResponseBody>(
      Urls.activityStream(activityId),
      options: Options(
        responseType: ResponseType.stream,
        headers: {'Accept': 'text/event-stream'},
        receiveTimeout: Duration.zero, // the stream stays open; server pings every 25s
      ),
    );
    yield* sseData(res.data!.stream).map((d) => Availability.fromJson(jsonDecode(d) as Map<String, dynamic>));
  }

  Future<void> reportLatency(Availability update, DateTime receivedAt, String? userId) async {
    await _dio.post<void>(
      Urls.events,
      options: _as(userId),
      data: {
        'name': 'availability_received',
        'activityId': update.activityId,
        'props': {
          'version': update.version,
          'committedAt': update.committedAt!.toUtc().toIso8601String(),
          'clientReceivedAt': receivedAt.toUtc().toIso8601String(),
          'clientSentAt': DateTime.now().toUtc().toIso8601String(),
        },
      },
    );
  }
}
