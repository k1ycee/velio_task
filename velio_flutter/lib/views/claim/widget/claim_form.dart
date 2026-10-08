import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';

import '../../../widgets/busy_button.dart';

class ClaimForm extends HookWidget {
  const ClaimForm({super.key, required this.busy, required this.soldOut, required this.onSubmit});

  final bool busy;
  final bool soldOut;
  final void Function(String name, String phone, String email) onSubmit;

  @override
  Widget build(BuildContext context) {
    final formKey = useMemoized(GlobalKey<FormState>.new);
    final name = useTextEditingController();
    final phone = useTextEditingController();
    final email = useTextEditingController();

    String? required(String? v) => (v == null || v.trim().isEmpty) ? 'Required' : null;

    void submit() {
      if (formKey.currentState!.validate()) onSubmit(name.text.trim(), phone.text.trim(), email.text.trim());
    }

    return Form(
      key: formKey,
      child: AutofillGroup(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextFormField(
              controller: name,
              enabled: !busy,
              decoration: const InputDecoration(labelText: 'Your name'),
              textInputAction: TextInputAction.next,
              autofillHints: const [AutofillHints.name],
              validator: required,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: phone,
              enabled: !busy,
              decoration: const InputDecoration(labelText: 'Phone'),
              keyboardType: TextInputType.phone,
              textInputAction: TextInputAction.next,
              autofillHints: const [AutofillHints.telephoneNumber],
              validator: required,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: email,
              enabled: !busy,
              decoration: const InputDecoration(labelText: 'Email'),
              keyboardType: TextInputType.emailAddress,
              textInputAction: TextInputAction.done,
              autofillHints: const [AutofillHints.email],
              validator: (v) => required(v) ?? (v!.contains('@') ? null : 'Enter a valid email'),
              onFieldSubmitted: (_) => submit(),
            ),
            const SizedBox(height: 16),
            BusyButton(
              label: soldOut ? 'Sold out' : 'Claim my spot',
              busyLabel: 'Claiming your spot…',
              busy: busy,
              onPressed: soldOut ? null : submit,
            ),
          ],
        ),
      ),
    );
  }
}
