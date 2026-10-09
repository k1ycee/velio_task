import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:velio_flutter/widgets/activity_cover.dart';

void main() {
  test('picks the same gradient as the web coverFor, by activity id', () {
    // velio_web/src/discover.ts COVERS, in order; id % 4 picks one.
    const web = [
      [0xFF1F1535, 0xFF3657F5],
      [0xFF212121, 0xFF6A3FD6],
      [0xFF1F1535, 0xFF0F8A6C],
      [0xFF212121, 0xFF0E7490],
    ];
    for (final id in ['0', '1', '2', '3', '478', '2113']) {
      final expected = web[int.parse(id) % 4].map(Color.new).toList();
      expect(coverGradient(id).colors, expected, reason: 'id $id');
    }
    expect(coverGradient('not-a-number').colors, web[0].map(Color.new).toList());
  });
}
