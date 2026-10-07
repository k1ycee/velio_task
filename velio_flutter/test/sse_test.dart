import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:velio_flutter/utils/sse.dart';

Stream<List<int>> chunks(List<String> parts) => Stream.fromIterable(parts.map(utf8.encode));

void main() {
  test('emits the data of each message, even when split across chunks', () async {
    final data = await sseData(chunks([
      'id: 1\ndata: {"a":',
      '1}\n\nid: 2\ndata: {"a":2}\n',
      '\n',
    ])).toList();
    expect(data, ['{"a":1}', '{"a":2}']);
  });

  test('skips named events such as pings', () async {
    final data = await sseData(chunks([
      'event: ping\ndata: {}\n\n',
      'data: {"a":3}\n\n',
    ])).toList();
    expect(data, ['{"a":3}']);
  });

  test('handles CRLF line endings', () async {
    final data = await sseData(chunks(['data: x\r\n\r\n'])).toList();
    expect(data, ['x']);
  });

  test('accepts a Uint8List stream, which is what Dio delivers', () async {
    final bytes = Stream<Uint8List>.fromIterable([Uint8List.fromList(utf8.encode('data: y\n\n'))]);
    expect(await sseData(bytes).toList(), ['y']);
  });
}
