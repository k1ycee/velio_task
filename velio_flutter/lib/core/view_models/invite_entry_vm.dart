import 'package:flutter/foundation.dart';

import '../repositories/invite_repo.dart';
import '../services/navigation_service.dart';
import '../services/storage_service.dart';

const usedVouchMessage = 'This vouch link has already been used. Ask your friend for a new one.';

/// The "Got an invite?" page: checks an invite before the claim page opens, so a used or
/// broken link is reported here (as a flashbar) and the claim page only ever shows a claimable invite.
class InviteEntryVM extends ChangeNotifier {
  InviteEntryVM(this._repo, this._storage, this._nav);

  final InviteRepository _repo;
  final StorageService _storage;
  final NavigationService _nav;

  bool _opening = false;
  bool get opening => _opening;

  String? _flash;
  String? get flash => _flash;

  /// Entry point for pasted codes, tapped links and the launch link alike.
  Future<void> open(String token) async {
    if (_opening) return;
    _opening = true;
    _flash = null;
    notifyListeners();

    final res = await _repo.getInvite(token, userId: await _storage.userId());
    _opening = false;
    res.fold(
      (f) => bounce(f.statusCode == 404 ? "That invite link doesn't exist." : f.message),
      (invite) {
        if (invite.isVouch && invite.used) return bounce(usedVouchMessage);
        notifyListeners();
        _nav.openClaim(token, invite);
      },
    );
  }

  /// Shows [message] on this page, returning here from the claim page if needed.
  void bounce(String message) {
    _flash = message;
    notifyListeners();
    _nav.backToHome();
  }

  void dismissFlash() {
    _flash = null;
    notifyListeners();
  }
}
