/// Point at your machine with `--dart-define=API_URL=http://<lan-ip>:3000` on a physical device.
/// The Android emulator reaches the host at 10.0.2.2.
const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://localhost:3000');

abstract final class Urls {
  static const users = '/users';
  static const events = '/events';
  static String invite(String token) => '/invites/$token';
  static String claim(String token) => '/invites/$token/claim';
  static String activityStream(String activityId) => '/activities/$activityId/stream';
}
