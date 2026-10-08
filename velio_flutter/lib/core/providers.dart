import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:hooks_riverpod/legacy.dart';

import 'repositories/activity_repo.dart';
import 'repositories/invite_repo.dart';
import 'services/navigation_service.dart';
import 'services/storage_service.dart';
import 'view_models/claim_vm.dart';
import 'view_models/invite_entry_vm.dart';
import 'view_models/my_activities_vm.dart';

final inviteRepo = Provider((ref) => InviteRepository());
final activityRepo = Provider((ref) => ActivityRepository());
final storageService = Provider((ref) => StorageService());
final navigationService = Provider((ref) {
  final service = NavigationService();
  ref.onDispose(service.dispose);
  return service;
});

/// Lives as long as the app: the "Got an invite?" page and its flashbar.
final inviteEntryVM = ChangeNotifierProvider(
  (ref) => InviteEntryVM(ref.read(inviteRepo), ref.read(storageService), ref.read(navigationService)),
);

/// Lives as long as the app: the "My activities" tab.
final myActivitiesVM = ChangeNotifierProvider(
  (ref) => MyActivitiesVM(ref.read(activityRepo), ref.read(storageService)),
);

/// One claim flow per open claim screen; disposed (and its live stream closed) when the screen goes.
final claimVM = ChangeNotifierProvider.autoDispose(
  (ref) => ClaimVM(
    ref.read(inviteRepo),
    ref.read(storageService),
    onInviteUnusable: (message) => ref.read(inviteEntryVM).bounce(message),
    onClaimed: () => ref.read(myActivitiesVM).load(),
  ),
);
