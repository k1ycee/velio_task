import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:hooks_riverpod/legacy.dart';

import 'repositories/invite_repo.dart';
import 'services/navigation_service.dart';
import 'services/storage_service.dart';
import 'view_models/claim_vm.dart';

final inviteRepo = Provider((ref) => InviteRepository());
final storageService = Provider((ref) => StorageService());
final navigationService = Provider((ref) {
  final service = NavigationService();
  ref.onDispose(service.dispose);
  return service;
});

/// One claim flow per open claim screen; disposed (and its live stream closed) when the screen goes.
final claimVM = ChangeNotifierProvider.autoDispose(
  (ref) => ClaimVM(ref.read(inviteRepo), ref.read(storageService)),
);
