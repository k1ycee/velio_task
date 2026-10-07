import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import 'core/providers.dart';
import 'views/home/home_screen.dart';

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
    WidgetsBinding.instance.addPostFrameCallback((_) => ref.read(navigationService).listenForInviteLinks());
  }

  @override
  Widget build(BuildContext context) {
    const seed = Color(0xFF1F6F5C);
    return MaterialApp(
      title: 'Velio',
      navigatorKey: ref.read(navigationService).navigatorKey,
      theme: ThemeData(colorSchemeSeed: seed, useMaterial3: true),
      darkTheme: ThemeData(colorSchemeSeed: seed, brightness: Brightness.dark, useMaterial3: true),
      home: const HomeScreen(),
    );
  }
}
