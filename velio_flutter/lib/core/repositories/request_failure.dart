import 'package:dio/dio.dart';

class RequestFailure {
  const RequestFailure({required this.message, this.statusCode, this.reason});

  final String message;
  final int? statusCode;

  /// The server's machine-readable reason, e.g. 'race_lost', 'used', 'duplicate'.
  final String? reason;

  factory RequestFailure.from(Object error) {
    if (error is DioException) {
      final body = error.response?.data;
      final map = body is Map ? body : const {};
      final msg = map['message'];
      return RequestFailure(
        statusCode: error.response?.statusCode,
        reason: map['reason'] as String?,
        message: msg is String
            ? msg
            : error.response == null
                ? "Can't reach Velio. Check your connection."
                : 'Something went wrong (${error.response?.statusCode}).',
      );
    }
    return RequestFailure(message: 'Something went wrong: $error');
  }
}
