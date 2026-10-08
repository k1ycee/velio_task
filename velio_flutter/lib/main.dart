import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import 'core/providers.dart';
import 'utils/invite_token.dart';
import 'views/controller/controller_screen.dart';

/// Demo shortcut: `flutter run --dart-define=INVITE=<token or velio:// link>` opens that invite on launch.
const _launchInvite = String.fromEnvironment('INVITE');

void main() {
  runApp(const ProviderScope(child: VelioApp()));
}

class VelioApp extends ConsumerStatefulWidget {
  const VelioApp({super.key});

  @override
  ConsumerState<VelioApp> createState() => _VelioAppState();
}

class _VelioAppState extends ConsumerState<VelioApp> {
  @override
  void initState() {
    super.initState();
    // Covers both the link that launched the app and links tapped while it runs.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(myActivitiesVM).load();
      final entry = ref.read(inviteEntryVM);
      ref.read(navigationService).listenForInviteLinks(entry.open);
      final token = inviteToken(_launchInvite);
      if (token != null) entry.open(token);
    });
  }

  @override
  Widget build(BuildContext context) {
    const seed = Color(0xFF1F6F5C);
    return MaterialApp(
      title: 'Velio',
      navigatorKey: ref.read(navigationService).navigatorKey,
      theme: ThemeData(colorSchemeSeed: seed, useMaterial3: true),
      darkTheme: ThemeData(colorSchemeSeed: seed, brightness: Brightness.dark, useMaterial3: true),
      home: const ControllerScreen(),
    );
  }
}
