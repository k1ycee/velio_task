import 'package:flutter_test/flutter_test.dart';
import 'package:velio_flutter/utils/invite_token.dart';

void main() {
  test('reads the token from a velio:// invite link', () {
    expect(inviteToken('velio://invite/abc_DEF-123'), 'abc_DEF-123');
  });

  test('accepts a bare code pasted by the guest', () {
    expect(inviteToken('  abc_DEF-123  '), 'abc_DEF-123');
  });

  test('rejects anything else', () {
    expect(inviteToken('velio://plan/12'), isNull);
    expect(inviteToken('https://example.com'), isNull);
    expect(inviteToken(''), isNull);
  });
}
