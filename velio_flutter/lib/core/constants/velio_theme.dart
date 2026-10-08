import 'package:flutter/material.dart';

/// The design tokens shared with the web app (`velio_web/src/index.css` `:root`); keep both in step.
@immutable
class VelioTokens extends ThemeExtension<VelioTokens> {
  const VelioTokens({
    required this.bg,
    required this.surface,
    required this.text,
    required this.muted,
    required this.border,
    required this.accent,
    required this.accentText,
    required this.warn,
    required this.warnBg,
    required this.danger,
    required this.dangerBg,
    required this.vouch,
    required this.vouchBg,
  });

  final Color bg, surface, text, muted, border, accent, accentText, warn, warnBg, danger, dangerBg, vouch, vouchBg;

  static const light = VelioTokens(
    bg: Color(0xFFF6F5F2),
    surface: Color(0xFFFFFFFF),
    text: Color(0xFF1C1B19),
    muted: Color(0xFF6B6860),
    border: Color(0xFFE3E0D9),
    accent: Color(0xFF1F6F5C),
    accentText: Color(0xFFFFFFFF),
    warn: Color(0xFF9A6200),
    warnBg: Color(0xFFFFF4DC),
    danger: Color(0xFFB3261E),
    dangerBg: Color(0xFFFDE8E6),
    vouch: Color(0xFF5B3FA8),
    vouchBg: Color(0xFFEFE9FB),
  );

  static const dark = VelioTokens(
    bg: Color(0xFF151513),
    surface: Color(0xFF1E1E1B),
    text: Color(0xFFEDEBE6),
    muted: Color(0xFFA19D94),
    border: Color(0xFF34332F),
    accent: Color(0xFF4FB89C),
    accentText: Color(0xFF0F1F1A),
    warn: Color(0xFFF0B84D),
    warnBg: Color(0xFF3A2C10),
    danger: Color(0xFFF2948C),
    dangerBg: Color(0xFF3D1B18),
    vouch: Color(0xFFB9A2F2),
    vouchBg: Color(0xFF2C2440),
  );

  /// Falls back to the matching token set when the theme wasn't built by [velioTheme] (e.g. in tests).
  static VelioTokens of(BuildContext context) {
    final theme = Theme.of(context);
    return theme.extension<VelioTokens>() ?? (theme.brightness == Brightness.dark ? dark : light);
  }

  @override
  VelioTokens copyWith() => this;

  @override
  VelioTokens lerp(VelioTokens? other, double t) => t < 0.5 || other == null ? this : other;
}

/// Material theme built from [VelioTokens], matching the web: flat bordered surfaces, 12px cards,
/// 8px controls, semibold buttons, outlined inputs.
ThemeData velioTheme(Brightness brightness) {
  final t = brightness == Brightness.light ? VelioTokens.light : VelioTokens.dark;
  final scheme = ColorScheme(
    brightness: brightness,
    primary: t.accent,
    onPrimary: t.accentText,
    secondary: t.accent,
    onSecondary: t.accentText,
    error: t.danger,
    onError: t.surface,
    errorContainer: t.dangerBg,
    onErrorContainer: t.danger,
    surface: t.surface,
    onSurface: t.text,
    onSurfaceVariant: t.muted,
    surfaceContainerHighest: t.border,
    outline: t.border,
    outlineVariant: t.border,
  );
  final controlShape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(8));
  const buttonText = TextStyle(fontSize: 16, fontWeight: FontWeight.w600);
  OutlineInputBorder inputBorder(Color c, [double w = 1]) => OutlineInputBorder(
    borderRadius: BorderRadius.circular(8),
    borderSide: BorderSide(color: c, width: w),
  );

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    extensions: [t],
    scaffoldBackgroundColor: t.bg,
    splashFactory: NoSplash.splashFactory,
    textTheme: TextTheme(
      headlineSmall: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, height: 1.2, color: t.text), // web h1
      titleMedium: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, height: 1.2, color: t.text), // web h2
      titleSmall: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: t.text), // web <strong>
      bodyLarge: TextStyle(fontSize: 16, height: 1.45, color: t.text),
      bodyMedium: TextStyle(fontSize: 15, height: 1.45, color: t.text),
      bodySmall: TextStyle(fontSize: 14, height: 1.4, color: t.muted), // web .muted.small
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        shape: controlShape,
        textStyle: buttonText,
        minimumSize: const Size(0, 48),
        disabledBackgroundColor: t.accent.withValues(alpha: 0.5),
        disabledForegroundColor: t.accentText,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        shape: controlShape,
        textStyle: buttonText,
        foregroundColor: t.accent,
        side: BorderSide(color: t.accent),
        minimumSize: const Size(0, 48),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(shape: controlShape, textStyle: buttonText, foregroundColor: t.accent),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: t.surface,
      labelStyle: TextStyle(color: t.muted),
      floatingLabelStyle: TextStyle(color: t.accent),
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      border: inputBorder(t.border),
      enabledBorder: inputBorder(t.border),
      disabledBorder: inputBorder(t.border),
      focusedBorder: inputBorder(t.accent, 2), // web :focus-visible outline
      errorBorder: inputBorder(t.danger),
      focusedErrorBorder: inputBorder(t.danger, 2),
      errorStyle: TextStyle(color: t.danger),
    ),
    cardTheme: CardThemeData(
      color: t.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(color: t.border),
      ),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: t.accent),
    // Bottom tabs: the web role toggle's active pill, as a tab bar.
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: t.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      indicatorColor: t.accent,
      indicatorShape: const StadiumBorder(),
      iconTheme: WidgetStateProperty.resolveWith(
        (s) => IconThemeData(color: s.contains(WidgetState.selected) ? t.accentText : t.muted),
      ),
      labelTextStyle: WidgetStateProperty.resolveWith(
        (s) => TextStyle(
          fontSize: 13,
          fontWeight: s.contains(WidgetState.selected) ? FontWeight.w600 : FontWeight.w400,
          color: s.contains(WidgetState.selected) ? t.text : t.muted,
        ),
      ),
    ),
    dividerTheme: DividerThemeData(color: t.border, thickness: 1, space: 1),
  );
}
