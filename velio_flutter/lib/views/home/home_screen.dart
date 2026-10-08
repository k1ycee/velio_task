import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../core/providers.dart';
import '../../utils/invite_token.dart';
import '../../widgets/busy_button.dart';
import '../../widgets/surfaces.dart';
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
      body: SafeArea(
        child: Stack(
          children: [
            Positioned.fill(
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  const PageHeader(
                    title: 'Got an invite?',
                    subtitle: 'Tap the link a friend sent you, or paste it here.',
                  ),
                  Panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        TextField(
                          controller: code,
                          enabled: !vm.opening,
                          decoration: InputDecoration(labelText: 'Invite link or code', errorText: error.value),
                          autocorrect: false,
                          textInputAction: TextInputAction.go,
                          onSubmitted: (_) => open(),
                        ),
                        const SizedBox(height: 12),
                        BusyButton(
                          label: 'Open invite',
                          busyLabel: 'Checking invite…',
                          busy: vm.opening,
                          onPressed: open,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            // The Stack clips, so the flashbar seems to drop from the top edge of the screen.
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
