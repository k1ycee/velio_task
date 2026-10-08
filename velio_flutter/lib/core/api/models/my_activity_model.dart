import 'invite_models.dart';

/// One activity the guest holds a spot in, for the "My activities" tab.
class MyActivity {
  const MyActivity({required this.planId, required this.role, required this.bookerName, required this.activity});

  final String planId;

  /// 'booker' or 'guest'.
  final String role;
  final String bookerName;
  final ActivityModel activity;

  bool get isBooker => role == 'booker';

  factory MyActivity.fromJson(Map<String, dynamic> j) => MyActivity(
    planId: j['planId'] as String,
    role: j['role'] as String,
    bookerName: j['bookerName'] as String,
    activity: ActivityModel.fromJson(j['activity'] as Map<String, dynamic>),
  );
}
