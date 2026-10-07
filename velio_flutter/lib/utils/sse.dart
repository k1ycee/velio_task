import 'dart:async';
import 'dart:convert';

/// Turns a Server-Sent Events byte stream into the `data:` payload of each
/// unnamed message. Named events (the server's `event: ping` keep-alives) are skipped.
Stream<String> sseData(Stream<List<int>> bytes) async* {
  final data = <String>[];
  var named = false;
  await for (final line in bytes.cast<List<int>>().transform(utf8.decoder).transform(const LineSplitter())) {
    if (line.isEmpty) {
      if (data.isNotEmpty && !named) yield data.join('\n');
      data.clear();
      named = false;
    } else if (line.startsWith('data:')) {
      data.add(line.substring(5).trimLeft());
    } else if (line.startsWith('event:')) {
      named = true;
    }
  }
}
