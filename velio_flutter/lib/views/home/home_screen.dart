import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../core/providers.dart';
import '../../utils/invite_token.dart';
import 'widget/flash_bar.dart';

/// Shown when the app is opened without an invite link: guests can paste a link or code.
/// Every invite is checked here first; a used or broken one shows a flashbar instead of opening.
class HomeScreen extends HookConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vm = ref.watch(inviteEntryVM);
    final code = useTextEditingController();
    final error = useState<String?>(null);

    void open() {
      final token = inviteToken(code.text);
      if (token == null) {
        error.value = "That doesn't look like a Velio invite.";
        return;
      }
      error.value = null;
      vm.open(token);
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Velio')),
      body: SafeArea(
        child: Stack(
          children: [
            Positioned.fill(
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  Text('Got an invite?', style: Theme.of(context).textTheme.headlineSmall),
                  const SizedBox(height: 8),
                  const Text('Tap the link a friend sent you, or paste it here.'),
                  const SizedBox(height: 20),
                  TextField(
                    controller: code,
                    decoration: InputDecoration(labelText: 'Invite link or code', errorText: error.value),
                    autocorrect: false,
                    textInputAction: TextInputAction.go,
                    onSubmitted: (_) => open(),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: vm.opening ? null : open,
                    style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                    child: vm.opening
                        ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('Open invite'),
                  ),
                ],
              ),
            ),
            // The Stack clips, so the flashbar seems to drop from under the app bar.
            if (vm.flash != null)
              Positioned(
                top: 0,
                left: 0,
                right: 0,
                child: FlashBar(message: vm.flash!, onDismiss: vm.dismissFlash),
              ),
          ],
        ),
      ),
    );
  }
}
