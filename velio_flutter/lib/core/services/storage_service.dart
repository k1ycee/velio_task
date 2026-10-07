import 'package:shared_preferences/shared_preferences.dart';

/// Remembers the guest's Velio user id, so the next invite doesn't ask again
/// and opens are attributed to them.
class StorageService {
  static const _userIdKey = 'velio.userId';

  Future<String?> userId() async => (await SharedPreferences.getInstance()).getString(_userIdKey);

  Future<void> saveUserId(String value) async =>
      (await SharedPreferences.getInstance()).setString(_userIdKey, value);
}
