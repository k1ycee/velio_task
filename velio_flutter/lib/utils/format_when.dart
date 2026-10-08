import 'package:flutter/material.dart';

/// Same short form as the web's `formatWhen` ("Fri, Oct 9, 7:00 PM"), in the device's time zone.
String formatWhen(MaterialLocalizations l10n, DateTime time) {
  final local = time.toLocal();
  return '${l10n.formatMediumDate(local)}, ${l10n.formatTimeOfDay(TimeOfDay.fromDateTime(local))}';
}
