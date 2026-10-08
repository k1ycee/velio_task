import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../core/constants/velio_theme.dart';
import '../../core/providers.dart';
import '../../core/services/navigation_service.dart';
import '../home/home_screen.dart';
import '../my_activities/my_activities_screen.dart';

/// The app's root: the "Invite" and "My activities" tabs. Claim pages are pushed above it.
class ControllerScreen extends HookConsumerWidget {
  const ControllerScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final nav = ref.read(navigationService);
    final tab = useValueListenable(nav.tab);

    return Scaffold(
      body: IndexedStack(index: tab, children: const [HomeScreen(), MyActivitiesScreen()]),
      // The web top bar's 1px border, on the tab bar.
      bottomNavigationBar: DecoratedBox(
        decoration: BoxDecoration(
          border: Border(top: BorderSide(color: VelioTokens.of(context).border)),
        ),
        child: NavigationBar(
          selectedIndex: tab,
          onDestinationSelected: (i) {
            nav.tab.value = i;
            if (i == NavigationService.myActivitiesTab) ref.read(myActivitiesVM).load();
          },
          destinations: const [
            NavigationDestination(icon: Icon(Icons.mail_outline), selectedIcon: Icon(Icons.mail), label: 'Invite'),
            NavigationDestination(
              icon: Icon(Icons.event_outlined),
              selectedIcon: Icon(Icons.event),
              label: 'My activities',
            ),
          ],
        ),
      ),
    );
  }
}
