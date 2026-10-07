import 'dart:async';

import 'package:flutter/foundation.dart';

import '../api/models/invite_models.dart';
import '../repositories/invite_repo.dart';
import '../repositories/request_failure.dart';
import '../services/storage_service.dart';

enum ClaimStatus { loading, ready, claiming, claimed, soldOut, error }

class ClaimVM extends ChangeNotifier {
  ClaimVM(this._repo, this._storage);

  final InviteRepository _repo;
  final StorageService _storage;

  ClaimStatus _status = ClaimStatus.loading;
  ClaimStatus get status => _status;

  InviteDetails? _invite;
  InviteDetails? get invite => _invite;

  int _spotsLeft = 0;
  int _version = -1;
  int get spotsLeft => _spotsLeft;

  String? _message;
  String? get message => _message;

  String? _token;
  String? _userId;
  StreamSubscription<Availability>? _live;
  Timer? _reconnect;
  bool _disposed = false;

  Future<void> open(String token) async {
    _token = token;
    _set(status: ClaimStatus.loading, message: null);
    _userId = await _storage.userId();
    final res = await _repo.getInvite(token, userId: _userId);
    res.fold(
      (f) => _set(status: ClaimStatus.error, message: f.message),
      (invite) {
        _invite = invite;
        _applyCount(invite.activity.spotsLeft, invite.activity.version);
        _set(status: invite.used ? ClaimStatus.soldOut : ClaimStatus.ready,
            message: invite.used ? 'This vouch link has already been used.' : null);
        _listen();
      },
    );
  }

  /// App came back to the foreground: reconnect, which starts with a fresh snapshot.
  void resume() {
    if (_invite != null) _listen();
  }

  Future<void> claim({required String name, required String phone, required String email}) async {
    final token = _token;
    if (token == null || _status == ClaimStatus.claiming) return;
    _set(status: ClaimStatus.claiming, message: null);

    if (_userId == null) {
      final created = await _repo.createUser(name, phone, email);
      final failure = created.fold((f) => f, (id) {
        _userId = id;
        return null;
      });
      if (failure != null) return _set(status: ClaimStatus.ready, message: failure.message);
      await _storage.saveUserId(_userId!);
    }

    final res = await _repo.claim(token, _userId!);
    res.fold(_onClaimFailure, (r) {
      _applyCount(r.spotsLeft, r.version);
      final fellBack = _invite?.isVouch == true && r.source == 'open';
      _set(
        status: ClaimStatus.claimed,
        message: fellBack ? "The spot held for you had been released, so we gave you an open spot instead." : null,
      );
    });
  }

  void _onClaimFailure(RequestFailure f) {
    switch (f.reason) {
      case 'race_lost':
        _set(status: ClaimStatus.soldOut, message: 'Sorry, that spot was just taken.');
      case 'used':
        _set(status: ClaimStatus.ready, message: 'This vouch link has already been used.');
      case 'duplicate':
        _set(status: ClaimStatus.ready, message: 'You already have a spot for this activity.');
      default:
        _set(status: ClaimStatus.ready, message: f.message);
    }
  }

  void _listen() {
    _reconnect?.cancel();
    _live?.cancel();
    final activityId = _invite!.activity.id;
    _live = _repo.availability(activityId).listen(
      (u) {
        if (_applyCount(u.spotsLeft, u.version)) notifyListeners();
        if (u.committedAt != null) _repo.reportLatency(u, DateTime.now(), _userId);
      },
      // ponytail: fixed 2s retry; add backoff if the server ever needs protecting from reconnect storms.
      onError: (_) => _scheduleReconnect(),
      onDone: _scheduleReconnect,
      cancelOnError: true,
    );
  }

  void _scheduleReconnect() {
    if (_disposed) return;
    _reconnect?.cancel();
    _reconnect = Timer(const Duration(seconds: 2), () => _disposed ? null : _listen());
  }

  /// Keeps the newest version only, so out-of-order messages never show an old count.
  bool _applyCount(int spotsLeft, int version) {
    if (version <= _version) return false;
    _version = version;
    _spotsLeft = spotsLeft;
    return true;
  }

  void _set({required ClaimStatus status, required String? message}) {
    _status = status;
    _message = message;
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _reconnect?.cancel();
    _live?.cancel();
    super.dispose();
  }
}
