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
    required this.subtle,
    required this.link,
    required this.warnLine,
  });

  final Color bg, surface, text, muted, border, accent, accentText, warn, warnBg, danger, dangerBg, vouch, vouchBg;

  /// Section bands and search fields; links, tabs and focus; the yellow outline on urgency badges.
  final Color subtle, link, warnLine;

  static const light = VelioTokens(
    bg: Color(0xFFFFFFFF),
    surface: Color(0xFFFFFFFF),
    text: Color(0xFF1F1535),
    muted: Color(0xFF6C6880),
    border: Color(0xFFE3E1EA),
    accent: Color(0xFF212121),
    accentText: Color(0xFFFFFFFF),
    warn: Color(0xFF212121),
    warnBg: Color(0xFFFFF8DB),
    danger: Color(0xFFC4162B),
    dangerBg: Color(0xFFFDECEE),
    vouch: Color(0xFF6A3FD6),
    vouchBg: Color(0xFFF1EBFF),
    subtle: Color(0xFFF7F6FA),
    link: Color(0xFF3657F5),
    warnLine: Color(0xFFF2C230),
  );

  static const dark = VelioTokens(
    bg: Color(0xFF120C1F),
    surface: Color(0xFF1C1530),
    text: Color(0xFFF1EEF7),
    muted: Color(0xFFA8A3B8),
    border: Color(0xFF342B47),
    accent: Color(0xFFF2F2F2),
    accentText: Color(0xFF212121),
    warn: Color(0xFFF5CF55),
    warnBg: Color(0xFF3A3010),
    danger: Color(0xFFFF8A93),
    dangerBg: Color(0xFF3F1620),
    vouch: Color(0xFFB89CFF),
    vouchBg: Color(0xFF2B2147),
    subtle: Color(0xFF17112A),
    link: Color(0xFF8DA2FF),
    warnLine: Color(0xFFF5CF55),
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

/// Bundled in assets/fonts (see pubspec.yaml).
const velioFontFamily = 'PlusJakartaSans';

/// Material theme built from [VelioTokens], matching the web: flat bordered surfaces, 12px cards,
/// 6px controls, semibold buttons, outlined inputs, Plus Jakarta Sans.
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
  final controlShape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(6));
  // Button styles replace the inherited text style, so they must name the family themselves.
  const buttonText = TextStyle(fontFamily: velioFontFamily, fontSize: 16, fontWeight: FontWeight.w600);
  OutlineInputBorder inputBorder(Color c, [double w = 1]) => OutlineInputBorder(
    borderRadius: BorderRadius.circular(6),
    borderSide: BorderSide(color: c, width: w),
  );

  return ThemeData(
    useMaterial3: true,
    fontFamily: velioFontFamily,
    brightness: brightness,
    colorScheme: scheme,
    extensions: [t],
    scaffoldBackgroundColor: t.bg,
    splashFactory: NoSplash.splashFactory,
    textTheme: TextTheme(
      headlineSmall: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, letterSpacing: -0.2, height: 1.2, color: t.text), // web h1
      titleMedium: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, height: 1.2, color: t.text), // web h2
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
        foregroundColor: t.text, // secondary actions are neutral; the accent is for booking only
        side: BorderSide(color: t.border),
        minimumSize: const Size(0, 48),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(shape: controlShape, textStyle: buttonText, foregroundColor: t.link),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: t.surface,
      // A fixed colour here would override Material's error red, so resolve per state: error wins.
      labelStyle: WidgetStateTextStyle.resolveWith(
        (s) => TextStyle(color: s.contains(WidgetState.error) ? t.danger : t.muted),
      ),
      floatingLabelStyle: WidgetStateTextStyle.resolveWith(
        (s) => TextStyle(
          color: s.contains(WidgetState.error)
              ? t.danger
              : (s.contains(WidgetState.focused) ? t.link : t.muted),
        ),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      border: inputBorder(t.border),
      enabledBorder: inputBorder(t.border),
      disabledBorder: inputBorder(t.border),
      focusedBorder: inputBorder(t.link, 2), // web :focus-visible outline
      errorBorder: inputBorder(t.danger),
      focusedErrorBorder: inputBorder(t.danger, 2),
      errorStyle: TextStyle(color: t.danger),
    ),
    cardTheme: CardThemeData(
      color: t.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
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
