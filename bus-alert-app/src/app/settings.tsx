import * as Linking from 'expo-linking';
import { useCallback, useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Field, Label, Muted, SectionTitle, ToggleRow, useTheme } from '../components/ui';
import { DEFAULT_SETTINGS, type AppSettings } from '../core/types';
import { requestLocationPermissions } from '../services/background';
import { deliver, ensureNotificationPermission } from '../services/notify';
import { applyUpdateNow, checkAndFetchUpdate, describeCurrentBuild } from '../services/ota';
import { applyMonitoringChanges, useMonitoringStatus } from '../services/runtime';
import {
  clearLogs,
  getApiKey,
  getLogs,
  getSettings,
  getTelegramToken,
  saveSettings,
  setApiKey,
  setTelegramToken,
  type LogEntry,
} from '../services/storage';

export default function SettingsScreen() {
  const t = useTheme();
  const status = useMonitoringStatus();
  const [apiKey, setKey] = useState('');
  const [tgToken, setTg] = useState('');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setKey(await getApiKey());
    setTg(await getTelegramToken());
    setSettings(await getSettings());
    setLogs(await getLogs());
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    await setApiKey(apiKey);
    await setTelegramToken(tgToken);
    await saveSettings(settings);
    await applyMonitoringChanges();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const askPermissions = async () => {
    const n = await ensureNotificationPermission();
    const loc = await requestLocationPermissions();
    await applyMonitoringChanges();
    if (!n || !loc.background) {
      Alert.alert(
        '권한 확인',
        `알림: ${n ? '허용' : '거부'}\n위치(항상): ${loc.background ? '허용' : '거부'}\n\n앱이 꺼져 있을 때도 알림을 받으려면 위치 권한을 "항상 허용"으로, 배터리 최적화를 "제한 없음"으로 설정해 주세요.`,
        [
          { text: '닫기', style: 'cancel' },
          { text: '설정 열기', onPress: () => void Linking.openSettings() },
        ],
      );
    } else {
      Alert.alert('권한 확인', '모든 권한이 허용되어 있습니다.');
    }
  };

  const checkUpdate = async () => {
    const r = await checkAndFetchUpdate();
    if (r === 'downloaded') {
      Alert.alert('새 버전 다운로드 완료', '지금 적용할까요?', [
        { text: '나중에', style: 'cancel' },
        { text: '지금 적용', onPress: () => void applyUpdateNow() },
      ]);
    } else {
      Alert.alert(
        '업데이트 확인',
        r === 'none' ? '최신 버전입니다.' : r === 'disabled' ? '개발 모드에서는 업데이트를 사용하지 않습니다.' : '업데이트 확인에 실패했습니다.',
      );
    }
  };

  const testNotify = async () => {
    await ensureNotificationPermission();
    await deliver({
      key: 'test',
      title: '🚌 [311번 버스 도착 안내] (테스트)',
      body: '⏳ 남은시간 : 4분 30초 후\n🚏 남은위치 : 2정류장 전\n📍 정류소명 : 테스트 정류장',
    });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <SectionTitle>공공데이터 API</SectionTitle>
        <Card>
          <Label hint="data.go.kr 에서 발급받은 일반 인증키 (Encoding/Decoding 모두 가능). 기기에 암호화 저장됩니다.">
            서비스 인증키
          </Label>
          <Field
            value={apiKey}
            onChangeText={setKey}
            placeholder="DATA_GO_KR_API_KEY"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <Muted style={{ marginTop: 8 }}>
            필요 API 활용신청: 국토교통부 TAGO 버스도착정보·버스정류소정보 / 경기도 버스도착정보·정류소조회(v2) / 서울시
            정류소정보조회
          </Muted>
        </Card>

        <SectionTitle>텔레그램 동시 전송 (선택)</SectionTitle>
        <Card>
          <ToggleRow
            label="텔레그램으로도 보내기"
            hint="기존 GitHub Actions 버전처럼 텔레그램 봇으로도 알림을 전달합니다."
            value={settings.telegramEnabled}
            onChange={(v) => setSettings({ ...settings, telegramEnabled: v })}
          />
          {settings.telegramEnabled && (
            <>
              <Label>봇 토큰</Label>
              <Field value={tgToken} onChangeText={setTg} placeholder="TELEGRAM_BOT_TOKEN" autoCapitalize="none" secureTextEntry />
              <View style={{ height: 10 }} />
              <Label>Chat ID</Label>
              <Field
                value={settings.telegramChatId}
                onChangeText={(v) => setSettings({ ...settings, telegramChatId: v.trim() })}
                placeholder="TELEGRAM_CHAT_ID"
                autoCapitalize="none"
              />
            </>
          )}
        </Card>

        <SectionTitle>백그라운드 동작</SectionTitle>
        <Card>
          <Text style={{ color: t.text, fontWeight: '700', marginBottom: 4 }}>
            상태: {status.running ? `실행 중 (${status.mode === 'ride' ? '하차 알림' : '도착 감시'})` : '중지됨'}
          </Text>
          {status.notice ? <Muted>{status.notice}</Muted> : null}
          <ToggleRow
            label="감시 시작 시각 안내 알림"
            hint="OS가 백그라운드 실행을 중단했을 때를 대비해 시작 시각에 예약 알림을 띄웁니다. 누르면 감시가 재개됩니다."
            value={settings.startReminderEnabled}
            onChange={(v) => setSettings({ ...settings, startReminderEnabled: v })}
          />
          <Button title="권한 확인 / 요청" variant="secondary" onPress={askPermissions} style={{ marginTop: 8 }} />
          <Button title="테스트 알림 보내기" variant="secondary" onPress={testNotify} style={{ marginTop: 8 }} />
        </Card>

        <Button title={saved ? '저장됨 ✓' : '저장'} onPress={save} />

        <SectionTitle>앱 버전</SectionTitle>
        <Card>
          <Muted>{describeCurrentBuild()}</Muted>
          <Button title="업데이트 확인" variant="secondary" onPress={checkUpdate} style={{ marginTop: 10 }} />
        </Card>

        <SectionTitle>활동 기록</SectionTitle>
        <Card>
          {logs.length === 0 ? (
            <Muted>기록이 없습니다.</Muted>
          ) : (
            logs.slice(0, 30).map((l, i) => (
              <Muted key={`${l.at}-${i}`} style={{ marginBottom: 4 }}>
                {new Date(l.at).toLocaleString('ko-KR', { hour12: false })} · {l.msg}
              </Muted>
            ))
          )}
          <View style={styles.row}>
            <Button title="새로고침" variant="secondary" onPress={() => void load()} style={{ flex: 1 }} />
            <Button
              title="기록 지우기"
              variant="secondary"
              onPress={async () => {
                await clearLogs();
                setLogs([]);
              }}
              style={{ flex: 1, marginLeft: 8 }}
            />
          </View>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 60 },
  row: { flexDirection: 'row', marginTop: 10 },
});
