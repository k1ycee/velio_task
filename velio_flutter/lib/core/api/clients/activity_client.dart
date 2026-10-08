import 'package:dio/dio.dart';

import '../models/my_activity_model.dart';
import '../urls.dart';

/// Thin Dio wrapper over the guest's own activities. Throws on failure; the repository translates.
class ActivityClient {
  ActivityClient([Dio? dio])
    : _dio = dio ?? Dio(BaseOptions(baseUrl: apiUrl, connectTimeout: const Duration(seconds: 10)));

  final Dio _dio;

  Future<List<MyActivity>> myActivities(String userId) async {
    final res = await _dio.get<List<dynamic>>(Urls.myActivities, options: Options(headers: {'X-User-Id': userId}));
    return res.data!.map((j) => MyActivity.fromJson(j as Map<String, dynamic>)).toList();
  }
}
