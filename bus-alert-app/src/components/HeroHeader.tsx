/**
 * 탭 화면 상단의 그라데이션 헤더
 */
import { LinearGradient } from 'expo-linear-gradient';
import { type ReactNode } from 'react';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  const dark = useColorScheme() === 'dark';
  return (
    <LinearGradient
      colors={dark ? ['#1B2C55', '#0F1A33'] : ['#2563EB', '#1D4ED8']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.wrap, { paddingTop: insets.top + 14 }]}
    >
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          <Text style={styles.title}>{title}</Text>
        </View>
        {right}
      </View>
      {children ? <View style={{ marginTop: 14 }}>{children}</View> : null}
    </LinearGradient>
  );
}

/** 헤더 위에 쓰는 흰색 반투명 배지 */
export function HeroPill({ text }: { text: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 18, paddingBottom: 18, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  subtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '700' },
  title: { color: '#FFFFFF', fontSize: 26, fontWeight: '900', marginTop: 2 },
  pill: { backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  pillText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
});
