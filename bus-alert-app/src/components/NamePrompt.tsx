/**
 * 이름 입력 대화상자 (즐겨찾기 정류장 이름 붙이기)
 */
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useTheme } from './ui';

export function NamePrompt({
  visible,
  title,
  message,
  initial = '',
  placeholder,
  suggestions = [],
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  message?: string;
  initial?: string;
  placeholder?: string;
  suggestions?: string[];
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const t = useTheme();
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (visible) setValue(initial);
  }, [visible, initial]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={[styles.box, { backgroundColor: t.card }]}>
          <Text style={[styles.title, { color: t.text }]}>{title}</Text>
          {message ? <Text style={{ color: t.sub, marginTop: 4, lineHeight: 19 }}>{message}</Text> : null}
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={t.sub}
            autoFocus
            maxLength={20}
            onSubmitEditing={() => onSubmit(value)}
            style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.inputBg }]}
          />
          {suggestions.length ? (
            <View style={styles.suggest}>
              {suggestions.map((s) => (
                <Pressable key={s} onPress={() => setValue(s)} style={[styles.chip, { backgroundColor: t.chip }]}>
                  <Text style={{ color: t.text, fontWeight: '600' }}>{s}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={styles.buttons}>
            <Pressable onPress={onCancel} style={styles.btn} hitSlop={8}>
              <Text style={{ color: t.sub, fontWeight: '800', fontSize: 15 }}>취소</Text>
            </Pressable>
            <Pressable onPress={() => onSubmit(value)} style={styles.btn} hitSlop={8}>
              <Text style={{ color: t.primary, fontWeight: '900', fontSize: 15 }}>저장</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 28 },
  box: { borderRadius: 20, padding: 20 },
  title: { fontSize: 18, fontWeight: '900' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, marginTop: 14 },
  suggest: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 18, gap: 18 },
  btn: { paddingVertical: 4, paddingHorizontal: 6 },
});
