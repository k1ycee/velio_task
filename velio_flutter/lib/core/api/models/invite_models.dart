class ActivityModel {
  const ActivityModel({
    required this.id,
    required this.title,
    required this.startsAt,
    required this.capacity,
    required this.spotsLeft,
    required this.version,
  });

  final String id;
  final String title;
  final DateTime startsAt;
  final int capacity;
  final int spotsLeft;
  final int version;

  factory ActivityModel.fromJson(Map<String, dynamic> j) => ActivityModel(
        id: j['id'] as String,
        title: j['title'] as String,
        startsAt: DateTime.parse(j['startsAt'] as String),
        capacity: j['capacity'] as int,
        spotsLeft: j['spotsLeft'] as int,
        version: j['version'] as int,
      );
}

class InviteDetails {
  const InviteDetails({
    required this.inviteId,
    required this.type,
    required this.label,
    required this.used,
    required this.planId,
    required this.inviterName,
    required this.activity,
  });

  final String inviteId;

  /// 'vouch' (the inviter stands behind this guest) or 'public' (a shared link).
  final String type;
  final String? label;
  final bool used;
  final String planId;
  final String inviterName;
  final ActivityModel activity;

  bool get isVouch => type == 'vouch';

  factory InviteDetails.fromJson(Map<String, dynamic> j) => InviteDetails(
        inviteId: j['inviteId'] as String,
        type: j['type'] as String,
        label: j['label'] as String?,
        used: j['used'] as bool,
        planId: j['planId'] as String,
        inviterName: j['inviterName'] as String,
        activity: ActivityModel.fromJson(j['activity'] as Map<String, dynamic>),
      );
}

class ClaimResult {
  const ClaimResult({
    required this.spotId,
    required this.planId,
    required this.source,
    required this.spotsLeft,
    required this.version,
  });

  final String spotId;
  final String planId;

  /// 'held' (a spot the inviter held) or 'open' (from the activity's open pool).
  final String source;
  final int spotsLeft;
  final int version;

  factory ClaimResult.fromJson(Map<String, dynamic> j) => ClaimResult(
        spotId: j['spotId'] as String,
        planId: j['planId'] as String,
        source: j['source'] as String,
        spotsLeft: j['spotsLeft'] as int,
        version: j['version'] as int,
      );
}

class Availability {
  const Availability({required this.activityId, required this.spotsLeft, required this.version, this.committedAt});

  final String activityId;
  final int spotsLeft;
  final int version;

  /// Server commit time; null for snapshots. Used to report end-to-end latency.
  final DateTime? committedAt;

  factory Availability.fromJson(Map<String, dynamic> j) => Availability(
        activityId: j['activityId'] as String,
        spotsLeft: j['spotsLeft'] as int,
        version: j['version'] as int,
        committedAt: j['committedAt'] == null ? null : DateTime.parse(j['committedAt'] as String),
      );
}
