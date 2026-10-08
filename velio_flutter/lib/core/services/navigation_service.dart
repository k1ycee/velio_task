import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';

import '../../utils/invite_token.dart';
import '../../views/claim/claim_screen.dart';
import '../api/models/invite_models.dart';

/// Owns the navigator and hands incoming `velio://invite/<token>` links to [onInvite],
/// both for the link that launched the app and for links tapped while it's running.
class NavigationService {
  static const inviteTab = 0;
  static const myActivitiesTab = 1;

  final navigatorKey = GlobalKey<NavigatorState>();

  /// The selected bottom tab.
  final tab = ValueNotifier(inviteTab);
  StreamSubscription<Uri>? _links;

  void openClaim(String token, InviteDetails invite) {
    navigatorKey.currentState?.push(MaterialPageRoute<void>(builder: (_) => ClaimScreen(token: token, invite: invite)));
  }

  /// Back to the "Got an invite?" tab, wherever the guest is.
  void backToHome() {
    navigatorKey.currentState?.popUntil((route) => route.isFirst);
    tab.value = inviteTab;
  }

  void listenForInviteLinks(void Function(String token) onInvite) {
    _links ??= AppLinks().uriLinkStream.listen((uri) {
      final token = inviteToken(uri.toString());
      if (token != null) onInvite(token);
    }, onError: (_) {});
  }

  void dispose() {
    _links?.cancel();
    tab.dispose();
  }
}
