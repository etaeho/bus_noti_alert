import * as Linking from 'expo-linking';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Field, Icon, Label, ListRow, Muted, Pill, SectionTitle, ToggleRow, useTheme } from '../../components/ui';
import { DEFAULT_SETTINGS, type AppSettings } from '../../core/types';
import { requestLocationPermissions } from '../../services/background';
import { deliver, ensureNotificationPermission } from '../../services/notify';
import { applyMonitoringChanges, useMonitoringStatus } from '../../services/runtime';
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
} from '../../services/storage';

const APK_URL = 'https://github.com/etaeho/bus_noti_alert/releases/download/app-dev/bus-alert.apk';

export default function SettingsScreen() {
  const t = useTheme();
  const status = useMonitoringStatus();
  const [apiKey, setKey] = useState('');
  const [savedKey, setSavedKey] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const [tgToken, setTg] = useState('');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [perm, setPerm] = useState({ notifications: false, foreground: false, background: false });

  const load = useCallback(async () => {
    const k = await getApiKey();
    setKey(k);
    setSavedKey(k);
    setEditingKey(!k);
    setTg(await getTelegramToken());
    setSettings(await getSettings());
    setLogs(await getLogs());
    const [np, fp, bp] = await Promise.all([
      Notifications.getPermissionsAsync().catch(() => null),
      Location.getForegroundPermissionsAsync().catch(() => null),
      Location.getBackgroundPermissionsAsync().catch(() => null),
    ]);
    setPerm({ notifications: !!np?.granted, foreground: !!fp?.granted, background: !!bp?.granted });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const saveKey = async () => {
    await setApiKey(apiKey);
    setSavedKey(apiKey.trim());
    setEditingKey(!apiKey.trim());
    await applyMonitoringChanges();
    Alert.alert('저장됨', apiKey.trim() ? 'API 키를 저장했습니다.' : 'API 키를 지웠습니다.');
  };

  const updateSettings = async (next: AppSettings) => {
    setSettings(next);
    await saveSettings(next);
    await applyMonitoringChanges();
  };

  const saveTelegram = async () => {
    await setTelegramToken(tgToken);
    await saveSettings(settings);
    Alert.alert('저장됨', '텔레그램 설정을 저장했습니다.');
  };

  const askNotifications = async () => {
    const ok = await ensureNotificationPermission();
    if (!ok) openSettingsPrompt('알림');
    await load();
  };

  const askLocation = async () => {
    const r = await requestLocationPermissions();
    await applyMonitoringChanges();
    if (!r.background) openSettingsPrompt('위치 "항상 허용"');
    await load();
  };

  const openSettingsPrompt = (what: string) =>
    Alert.alert('설정에서 허용해 주세요', `${what} 권한을 휴대폰 설정에서 직접 허용해야 합니다.`, [
      { text: '닫기', style: 'cancel' },
      { text: '설정 열기', onPress: () => void Linking.openSettings() },
    ]);

  const testNotify = async () => {
    await ensureNotificationPermission();
    await deliver({
      key: 'test',
      title: '🚌 311번 3정거장 전 (테스트)',
      body: '⏳ 약 6분 후 도착\n📍 테스트 정류장',
    });
    Alert.alert('테스트 알림', '알림을 보냈습니다. 알림 기록 탭에서도 확인할 수 있습니다.');
  };

  const permBadge = (ok: boolean) => (ok ? <Pill text="허용됨" tone="success" icon="checkmark" /> : <Pill text="필요" tone="warning" />);
  const maskedKey = savedKey ? `${savedKey.slice(0, 6)}••••••${savedKey.slice(-4)}` : '';

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <SectionTitle>공공데이터 API 키</SectionTitle>
        <Card>
          {!editingKey && savedKey ? (
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Pill text="등록됨" tone="success" icon="key" />
                <Text style={{ color: t.text, marginTop: 6, fontVariant: ['tabular-nums'] }}>{maskedKey}</Text>
              </View>
              <Button title="변경" variant="secondary" small onPress={() => setEditingKey(true)} />
            </View>
          ) : (
            <>
              <Label hint="data.go.kr 에서 발급받은 일반 인증키 (Encoding / Decoding 모두 가능). 기기에 암호화 저장됩니다.">
                서비스 인증키
              </Label>
              <Field
                value={apiKey}
                onChangeText={setKey}
                placeholder="인증키 붙여넣기"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              <Button title="저장" icon="save" onPress={saveKey} style={{ marginTop: 10 }} />
            </>
          )}
          <Pressable onPress={() => void Linking.openURL('https://www.data.go.kr')} style={{ marginTop: 12 }}>
            <Muted>
              활용신청이 필요한 API: TAGO 버스도착정보 · 버스정류소정보 · 버스노선정보(방면) / 경기도 버스도착정보 ·
              정류소조회(v2) / 서울시 정류소정보조회{'  '}
              <Text style={{ color: t.primary, fontWeight: '700' }}>data.go.kr 열기 ›</Text>
            </Muted>
          </Pressable>
        </Card>

        <SectionTitle>권한</SectionTitle>
        <Card>
          <ListRow
            icon="notifications"
            title="알림"
            subtitle="버스 도착 · 하차 알림 표시"
            right={permBadge(perm.notifications)}
            onPress={perm.notifications ? undefined : askNotifications}
          />
          <ListRow
            icon="location"
            title='위치 "항상 허용"'
            subtitle="앱을 닫아도 감시를 계속하기 위해 필요 (위치 값은 저장하지 않음)"
            right={permBadge(perm.background)}
            onPress={perm.background ? undefined : askLocation}
          />
          <ListRow
            icon="battery-charging"
            iconColor={t.warning}
            title="배터리 최적화 제외 (권장)"
            subtitle="삼성·샤오미 등은 휴대폰 설정 › 앱 › 버스 알리미 › 배터리 › 제한 없음"
            onPress={() => void Linking.openSettings()}
            last
          />
        </Card>

        <SectionTitle>백그라운드 감시</SectionTitle>
        <Card>
          <View style={styles.rowBetween}>
            <Text style={{ color: t.text, fontWeight: '800', fontSize: 15 }}>현재 상태</Text>
            {status.running ? (
              <Pill text={status.mode === 'ride' ? '하차 알림 실행 중' : '실행 중'} tone="success" icon="radio" />
            ) : (
              <Pill text="중지됨" />
            )}
          </View>
          {status.notice ? <Muted style={{ marginTop: 6 }}>{status.notice}</Muted> : null}
          <View style={{ height: 8 }} />
          <ToggleRow
            label="감시 시작 시각 안내 알림"
            hint="휴대폰이 백그라운드 실행을 멈췄을 때를 대비해 시작 시각에 알림을 띄웁니다. 누르면 감시가 다시 시작됩니다."
            value={settings.startReminderEnabled}
            onChange={(v) => void updateSettings({ ...settings, startReminderEnabled: v })}
          />
          <Button title="테스트 알림 보내기" icon="paper-plane" variant="secondary" onPress={testNotify} style={{ marginTop: 6 }} />
        </Card>

        <SectionTitle>텔레그램 동시 전송 (선택)</SectionTitle>
        <Card>
          <ToggleRow
            label="텔레그램으로도 보내기"
            hint="기존 GitHub Actions 버전처럼 텔레그램 봇으로도 알림을 보냅니다."
            value={settings.telegramEnabled}
            onChange={(v) => void updateSettings({ ...settings, telegramEnabled: v })}
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
              <Button title="텔레그램 설정 저장" variant="secondary" onPress={saveTelegram} style={{ marginTop: 10 }} />
            </>
          )}
        </Card>

        <SectionTitle>앱 정보</SectionTitle>
        <Card>
          <ListRow icon="information-circle" title="설치된 버전" subtitle={process.env.EXPO_PUBLIC_BUILD_INFO || '로컬 개발 빌드'} />
          <ListRow
            icon="download"
            title="최신 버전 받기"
            subtitle="새 APK를 받아 덮어 설치하면 설정이 유지됩니다"
            onPress={() => void Linking.openURL(APK_URL)}
          />
          <ListRow
            icon="document-text"
            title="활동 기록 (문제 해결용)"
            subtitle={`${logs.length}건`}
            right={<Icon name={showLogs ? 'chevron-up' : 'chevron-down'} size={18} color={t.sub} />}
            onPress={() => setShowLogs(!showLogs)}
            last
          />
          {showLogs ? (
            <View style={{ marginTop: 6 }}>
              {logs.length === 0 ? (
                <Muted>기록이 없습니다.</Muted>
              ) : (
                logs.slice(0, 40).map((l, i) => (
                  <Muted key={`${l.at}-${i}`} style={{ marginBottom: 4 }}>
                    {new Date(l.at).toLocaleString('ko-KR', { hour12: false })} · {l.msg}
                  </Muted>
                ))
              )}
              <Button
                title="활동 기록 지우기"
                variant="ghost"
                small
                onPress={async () => {
                  await clearLogs();
                  setLogs([]);
                }}
              />
            </View>
          ) : null}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 60 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
