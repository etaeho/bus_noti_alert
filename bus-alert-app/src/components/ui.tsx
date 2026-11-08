import { type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useColorScheme,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import type { TimeOfDay } from '../core/types';

const light = {
  bg: '#F3F5F9',
  card: '#FFFFFF',
  text: '#121722',
  sub: '#5C6578',
  border: '#E1E5EE',
  primary: '#1E6FD9',
  primaryText: '#FFFFFF',
  danger: '#D93B3B',
  success: '#1F9D55',
  chip: '#EAF1FC',
  inputBg: '#F7F8FB',
};
const dark: typeof light = {
  bg: '#0E1117',
  card: '#181C25',
  text: '#ECEFF5',
  sub: '#9AA3B5',
  border: '#2A3040',
  primary: '#4C93F0',
  primaryText: '#FFFFFF',
  danger: '#F06A6A',
  success: '#45C47E',
  chip: '#1F2B40',
  inputBg: '#11151D',
};
export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }, style]}>{children}</View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.section, { color: t.sub }]}>{children}</Text>;
}

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: 6 }}>
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
      style={[
        styles.input,
        { backgroundColor: t.inputBg, borderColor: t.border, color: t.text },
        props.style,
      ]}
    />
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const bg = variant === 'primary' ? t.primary : variant === 'danger' ? t.danger : t.chip;
  const fg = variant === 'secondary' ? t.primary : t.primaryText;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
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
      style={[
        styles.chip,
        { backgroundColor: selected ? t.primary : t.chip, borderColor: selected ? t.primary : t.border },
      ]}
    >
      <Text style={{ color: selected ? t.primaryText : t.text, fontWeight: '600' }}>{label}</Text>
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
        style={[styles.stepBtn, { backgroundColor: t.chip }]}
      >
        <Text style={[styles.stepBtnText, { color: t.primary }]}>−</Text>
      </Pressable>
      <Text style={[styles.stepValue, { color: t.text }]}>
        {value}
        {unit}
      </Text>
      <Pressable
        accessibilityLabel="증가"
        onPress={() => onChange(clamp(value + step))}
        style={[styles.stepBtn, { backgroundColor: t.chip }]}
      >
        <Text style={[styles.stepBtnText, { color: t.primary }]}>+</Text>
      </Pressable>
    </View>
  );
}

/** 시:분 선택기 (시 1단위, 분 5단위) */
export function TimeStepper({ value, onChange }: { value: TimeOfDay; onChange: (v: TimeOfDay) => void }) {
  const t = useTheme();
  const btn = (label: string, fn: () => void, a11y: string) => (
    <Pressable accessibilityLabel={a11y} onPress={fn} style={[styles.timeBtn, { backgroundColor: t.chip }]}>
      <Text style={{ color: t.primary, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
  const setH = (d: number) => onChange({ ...value, hour: (value.hour + d + 24) % 24 });
  const setM = (d: number) => onChange({ ...value, minute: (value.minute + d + 60) % 60 });
  return (
    <View style={styles.timeWrap}>
      <View style={styles.timeCol}>
        {btn('▲', () => setH(1), '시 증가')}
        <Text style={[styles.timeText, { color: t.text }]}>{String(value.hour).padStart(2, '0')}</Text>
        {btn('▼', () => setH(-1), '시 감소')}
      </View>
      <Text style={[styles.timeText, { color: t.text }]}>:</Text>
      <View style={styles.timeCol}>
        {btn('▲', () => setM(5), '분 증가')}
        <Text style={[styles.timeText, { color: t.text }]}>{String(value.minute).padStart(2, '0')}</Text>
        {btn('▼', () => setM(-5), '분 감소')}
      </View>
    </View>
  );
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  const t = useTheme();
  return <Text style={[{ color: t.sub, fontSize: 13, lineHeight: 18 }, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 16, borderWidth: StyleSheet.hairlineWidth, marginBottom: 12 },
  section: { fontSize: 13, fontWeight: '700', marginTop: 8, marginBottom: 8, marginLeft: 4 },
  label: { fontSize: 15, fontWeight: '600' },
  hint: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  button: { borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '700' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, marginRight: 8, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { fontSize: 22, fontWeight: '700' },
  stepValue: { minWidth: 76, textAlign: 'center', fontSize: 17, fontWeight: '700' },
  timeWrap: { flexDirection: 'row', alignItems: 'center' },
  timeCol: { alignItems: 'center' },
  timeBtn: { paddingHorizontal: 14, paddingVertical: 4, borderRadius: 8, marginVertical: 4 },
  timeText: { fontSize: 30, fontWeight: '700', marginHorizontal: 8, fontVariant: ['tabular-nums'] },
});
