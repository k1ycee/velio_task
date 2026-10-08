import 'package:fpdart/fpdart.dart';

import '../api/clients/activity_client.dart';
import '../api/models/my_activity_model.dart';
import 'request_failure.dart';

class ActivityRepository {
  ActivityRepository([ActivityClient? client]) : _client = client ?? ActivityClient();

  final ActivityClient _client;

  Future<Either<RequestFailure, List<MyActivity>>> myActivities(String userId) =>
      attempt(() => _client.myActivities(userId));
}
