import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';

import '../../utils/invite_token.dart';
import '../../views/claim/claim_screen.dart';

/// Owns the navigator and routes incoming `velio://invite/<token>` links to the claim screen,
/// both for the link that launched the app and for links tapped while it's running.
class NavigationService {
  final navigatorKey = GlobalKey<NavigatorState>();
  StreamSubscription<Uri>? _links;

  void openInvite(String token) {
    navigatorKey.currentState?.push(MaterialPageRoute<void>(builder: (_) => ClaimScreen(token: token)));
  }

  void listenForInviteLinks() {
    _links ??= AppLinks().uriLinkStream.listen((uri) {
      final token = inviteToken(uri.toString());
      if (token != null) openInvite(token);
    }, onError: (_) {});
  }

  void dispose() => _links?.cancel();
}
