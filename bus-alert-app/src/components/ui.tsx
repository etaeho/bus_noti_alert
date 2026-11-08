/**
 * 공통 UI 컴포넌트 · 테마 (라이트/다크)
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { type ComponentProps, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useColorScheme,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import type { TimeOfDay } from '../core/types';

const light = {
  bg: '#F2F4F8',
  card: '#FFFFFF',
  text: '#111827',
  sub: '#6B7280',
  border: '#E5E7EB',
  primary: '#2563EB',
  primarySoft: '#E8EFFE',
  primaryText: '#FFFFFF',
  danger: '#DC2626',
  dangerSoft: '#FDECEC',
  success: '#16A34A',
  successSoft: '#E7F6EC',
  warning: '#D97706',
  warningSoft: '#FDF3E1',
  chip: '#EEF2F7',
  inputBg: '#F7F8FA',
  shadow: '#0F172A',
};
const dark: typeof light = {
  bg: '#0B0F17',
  card: '#151B26',
  text: '#F1F4F9',
  sub: '#98A2B3',
  border: '#263042',
  primary: '#5B8DEF',
  primarySoft: '#1B2A47',
  primaryText: '#FFFFFF',
  danger: '#F26B6B',
  dangerSoft: '#3A1E22',
  success: '#4ACB7C',
  successSoft: '#17321F',
  warning: '#F0A43A',
  warningSoft: '#3A2C14',
  chip: '#1E2635',
  inputBg: '#101520',
  shadow: '#000000',
};
export type Theme = typeof light;
export type IconName = ComponentProps<typeof Ionicons>['name'];

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export function Icon({ name, size = 20, color, style }: { name: IconName; size?: number; color?: string; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <Ionicons name={name} size={size} color={color ?? t.text} style={style} />;
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const t = useTheme();
  const base = [styles.card, { backgroundColor: t.card, shadowColor: t.shadow, borderColor: t.border }, style];
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.85 }]}>
        {children}
      </Pressable>
    );
  }
  return <View style={base}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.sectionRow}>
      <Text style={[styles.section, { color: t.sub }]}>{children}</Text>
      {right}
    </View>
  );
}

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={[styles.label, { color: t.text }]}>{children}</Text>
      {hint ? <Text style={[styles.hint, { color: t.sub }]}>{hint}</Text> : null}
    </View>
  );
}

export function Field(props: TextInputProps) {
  const t = useTheme();
  return (
    <TextInput
      placeholderTextColor={t.sub}
      {...props}
      style={[styles.input, { backgroundColor: t.inputBg, borderColor: t.border, color: t.text }, props.style]}
    />
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  style,
  icon,
  small,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  icon?: IconName;
  small?: boolean;
}) {
  const t = useTheme();
  const bg =
    variant === 'primary' ? t.primary : variant === 'danger' ? t.danger : variant === 'secondary' ? t.primarySoft : 'transparent';
  const fg = variant === 'secondary' || variant === 'ghost' ? t.primary : t.primaryText;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={small ? 16 : 18} color={fg} style={{ marginRight: 6 }} /> : null}
      <Text style={[styles.buttonText, small && { fontSize: 14 }, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, { backgroundColor: selected ? t.primary : t.chip, borderColor: selected ? t.primary : t.border }]}
    >
      <Text style={{ color: selected ? t.primaryText : t.text, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

/** 작은 상태 배지 */
export function Pill({
  text,
  tone = 'neutral',
  icon,
}: {
  text: string;
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
  icon?: IconName;
}) {
  const t = useTheme();
  const map = {
    neutral: [t.chip, t.sub],
    primary: [t.primarySoft, t.primary],
    success: [t.successSoft, t.success],
    warning: [t.warningSoft, t.warning],
    danger: [t.dangerSoft, t.danger],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={fg} style={{ marginRight: 4 }} /> : null}
      <Text style={{ color: fg, fontSize: 12, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

/** 노선 번호 배지 */
export function RouteBadge({ route, active }: { route: string; active?: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.routeBadge, { backgroundColor: active ? t.primary : t.primarySoft }]}>
      <Text style={{ color: active ? t.primaryText : t.primary, fontWeight: '800', fontSize: 14 }}>{route}</Text>
    </View>
  );
}

/** 아이콘 + 제목 + 설명 + 오른쪽 요소 */
export function ListRow({
  icon,
  iconColor,
  title,
  subtitle,
  right,
  onPress,
  last,
}: {
  icon?: IconName;
  iconColor?: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const t = useTheme();
  const content = (
    <View style={[styles.listRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border }]}>
      {icon ? (
        <View style={[styles.iconCircle, { backgroundColor: (iconColor ?? t.primary) + '1F' }]}>
          <Ionicons name={icon} size={18} color={iconColor ?? t.primary} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { color: t.text }]}>{title}</Text>
        {subtitle ? <Text style={[styles.hint, { color: t.sub }]}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={t.sub} /> : null)}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.7 }}>
      {content}
    </Pressable>
  ) : (
    content
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body: string; action?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: t.primarySoft }]}>
        <Ionicons name={icon} size={34} color={t.primary} />
      </View>
      <Text style={[styles.emptyTitle, { color: t.text }]}>{title}</Text>
      <Text style={[styles.emptyBody, { color: t.sub }]}>{body}</Text>
      {action}
    </View>
  );
}

/** 오른쪽 아래 떠 있는 추가 버튼 */
export function Fab({ onPress, label, icon = 'add' }: { onPress: () => void; label: string; icon?: IconName }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.fab, { backgroundColor: t.primary, shadowColor: t.shadow, opacity: pressed ? 0.85 : 1 }]}
    >
      <Ionicons name={icon} size={22} color={t.primaryText} />
      <Text style={{ color: t.primaryText, fontWeight: '800', marginLeft: 6, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

export function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const t = useTheme();
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={[styles.label, { color: t.text }]}>{label}</Text>
        {hint ? <Text style={[styles.hint, { color: t.sub }]}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: t.primary }} />
    </View>
  );
}

/** − 값 + 형태의 숫자 조절기 */
export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = '',
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}) {
  const t = useTheme();
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityLabel="감소"
        onPress={() => onChange(clamp(value - step))}
        style={[styles.stepBtn, { backgroundColor: t.primarySoft }]}
      >
        <Ionicons name="remove" size={20} color={t.primary} />
      </Pressable>
      <Text style={[styles.stepValue, { color: t.text }]}>
        {value}
        {unit}
      </Text>
      <Pressable
        accessibilityLabel="증가"
        onPress={() => onChange(clamp(value + step))}
        style={[styles.stepBtn, { backgroundColor: t.primarySoft }]}
      >
        <Ionicons name="add" size={20} color={t.primary} />
      </Pressable>
    </View>
  );
}

/** 시:분 선택기 (시 1단위, 분 5단위) */
export function TimeStepper({ value, onChange }: { value: TimeOfDay; onChange: (v: TimeOfDay) => void }) {
  const t = useTheme();
  const btn = (icon: IconName, fn: () => void, a11y: string) => (
    <Pressable accessibilityLabel={a11y} onPress={fn} style={[styles.timeBtn, { backgroundColor: t.primarySoft }]}>
      <Ionicons name={icon} size={18} color={t.primary} />
    </Pressable>
  );
  const setH = (d: number) => onChange({ ...value, hour: (value.hour + d + 24) % 24 });
  const setM = (d: number) => onChange({ ...value, minute: (value.minute + d + 60) % 60 });
  return (
    <View style={styles.timeWrap}>
      <View style={styles.timeCol}>
        {btn('chevron-up', () => setH(1), '시 증가')}
        <Text style={[styles.timeText, { color: t.text }]}>{String(value.hour).padStart(2, '0')}</Text>
        {btn('chevron-down', () => setH(-1), '시 감소')}
      </View>
      <Text style={[styles.timeText, { color: t.text }]}>:</Text>
      <View style={styles.timeCol}>
        {btn('chevron-up', () => setM(5), '분 증가')}
        <Text style={[styles.timeText, { color: t.text }]}>{String(value.minute).padStart(2, '0')}</Text>
        {btn('chevron-down', () => setM(-5), '분 감소')}
      </View>
    </View>
  );
}

export function Muted({ children, style, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  const t = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[{ color: t.sub, fontSize: 13, lineHeight: 18 }, style]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: Platform.OS === 'android' ? 0 : StyleSheet.hairlineWidth,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, marginBottom: 8, marginHorizontal: 4 },
  section: { fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  label: { fontSize: 15, fontWeight: '700' },
  hint: { fontSize: 12.5, marginTop: 2, lineHeight: 17 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  button: { flexDirection: 'row', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  buttonSmall: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  buttonText: { fontSize: 16, fontWeight: '800' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, marginRight: 8, marginBottom: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },
  routeBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, marginRight: 6, marginBottom: 6 },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  iconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  empty: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 16 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { fontSize: 17, fontWeight: '800', marginBottom: 6 },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 14 },
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 28,
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 72, textAlign: 'center', fontSize: 17, fontWeight: '800' },
  timeWrap: { flexDirection: 'row', alignItems: 'center' },
  timeCol: { alignItems: 'center' },
  timeBtn: { paddingHorizontal: 14, paddingVertical: 4, borderRadius: 8, marginVertical: 4 },
  timeText: { fontSize: 32, fontWeight: '800', marginHorizontal: 8, fontVariant: ['tabular-nums'] },
});
