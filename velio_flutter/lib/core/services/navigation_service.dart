import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';

import '../../utils/invite_token.dart';
import '../../views/claim/claim_screen.dart';
import '../api/models/invite_models.dart';

/// Owns the navigator and hands incoming `velio://invite/<token>` links to [onInvite],
/// both for the link that launched the app and for links tapped while it's running.
class NavigationService {
  final navigatorKey = GlobalKey<NavigatorState>();
  StreamSubscription<Uri>? _links;

  void openClaim(String token, InviteDetails invite) {
    navigatorKey.currentState?.push(MaterialPageRoute<void>(builder: (_) => ClaimScreen(token: token, invite: invite)));
  }

  void backToHome() => navigatorKey.currentState?.popUntil((route) => route.isFirst);

  void listenForInviteLinks(void Function(String token) onInvite) {
    _links ??= AppLinks().uriLinkStream.listen((uri) {
      final token = inviteToken(uri.toString());
      if (token != null) onInvite(token);
    }, onError: (_) {});
  }

  void dispose() => _links?.cancel();
}
