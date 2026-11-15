/**
 * 탭 화면 상단 큰 제목 (iOS 큰 제목 스타일)
 *  - 배경은 화면 배경과 같게, 제목은 크고 굵게, 설명은 작은 회색 글씨
 */
import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from './ui';

export function HeroHeader({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const t = useTheme();
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 16 }]}>
      <View style={styles.row}>
        <Text style={[styles.title, { color: t.text }]} accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        {right}
      </View>
      {subtitle ? <Text style={[styles.subtitle, { color: t.sub }]}>{subtitle}</Text> : null}
      {children ? <View style={{ marginTop: 12 }}>{children}</View> : null}
    </View>
  );
}

/** 제목 옆 상태 배지 */
export function HeroPill({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'live' }) {
  const t = useTheme();
  const live = tone === 'live';
  return (
    <View style={[styles.pill, { backgroundColor: live ? t.successSoft : t.chip }]}>
      {live ? <View style={[styles.dot, { backgroundColor: t.success }]} /> : null}
      <Text style={[styles.pillText, { color: live ? t.success : t.sub }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  title: { flex: 1, fontSize: 30, fontWeight: '800', letterSpacing: -0.8 },
  subtitle: { fontSize: 13.5, marginTop: 2 },
  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  pillText: { fontWeight: '700', fontSize: 12 },
});
