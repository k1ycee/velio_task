final _token = RegExp(r'^[A-Za-z0-9_-]{8,}$');

/// The invite token from a `velio://invite/<token>` link, or from a bare code
/// the guest pasted. Null if it's neither.
String? inviteToken(String input) {
  final text = input.trim();
  final uri = Uri.tryParse(text);
  if (uri != null && uri.scheme == 'velio') {
    if (uri.host != 'invite' || uri.pathSegments.length != 1) return null;
    final token = uri.pathSegments.single;
    return _token.hasMatch(token) ? token : null;
  }
  return _token.hasMatch(text) ? text : null;
}
