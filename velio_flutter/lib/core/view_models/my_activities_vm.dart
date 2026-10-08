import 'package:flutter/foundation.dart';

import '../api/models/my_activity_model.dart';
import '../repositories/activity_repo.dart';
import '../services/storage_service.dart';

enum MyActivitiesStatus { loading, ready, error }

/// The "My activities" tab: every activity the guest booked or claimed, split into upcoming and past.
class MyActivitiesVM extends ChangeNotifier {
  MyActivitiesVM(this._repo, this._storage, {DateTime Function()? now}) : _now = now ?? DateTime.now;

  final ActivityRepository _repo;
  final StorageService _storage;
  final DateTime Function() _now;

  MyActivitiesStatus _status = MyActivitiesStatus.loading;
  MyActivitiesStatus get status => _status;

  String? _message;
  String? get message => _message;

  List<MyActivity> _items = const [];

  /// Soonest first (the server's order).
  List<MyActivity> get upcoming => _items.where((a) => a.activity.startsAt.isAfter(_now())).toList();

  /// Most recent first.
  List<MyActivity> get past => _items.where((a) => !a.activity.startsAt.isAfter(_now())).toList().reversed.toList();

  /// Shows the spinner only on the first load; later reloads swap the list in place.
  Future<void> load() async {
    final userId = await _storage.userId();
    if (userId == null) return _set(MyActivitiesStatus.ready, const [], null); // hasn't claimed anything yet

    final res = await _repo.myActivities(userId);
    res.fold(
      (f) => _set(MyActivitiesStatus.error, _items, f.message),
      (items) => _set(MyActivitiesStatus.ready, items, null),
    );
  }

  void _set(MyActivitiesStatus status, List<MyActivity> items, String? message) {
    _status = status;
    _items = items;
    _message = message;
    notifyListeners();
  }
}
