import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Button, Card, Muted, SectionTitle, useTheme } from '../components/ui';
import { describeAlertRule, formatArrSec } from '../core/format';
import { describeDays, formatTime, getActiveWindow, getNextWindowStart } from '../core/schedule';
import { REGION_LABELS, type AlarmRuntimeState, type BusAlarm, type RideAlert, type RideRuntimeState } from '../core/types';
import { applyMonitoringChanges, useMonitoringStatus } from '../services/runtime';
import { getAlarms, getAllAlarmStates, getApiKey, getRide, getRideState, upsertAlarm } from '../services/storage';

export default function HomeScreen() {
  const t = useTheme();
  const status = useMonitoringStatus();
  const [alarms, setAlarms] = useState<BusAlarm[]>([]);
  const [states, setStates] = useState<Record<string, AlarmRuntimeState>>({});
  const [ride, setRide] = useState<RideAlert | null>(null);
  const [rideState, setRideState] = useState<RideRuntimeState | null>(null);
  const [hasKey, setHasKey] = useState(true);
  const [now, setNow] = useState(new Date());

  const load = useCallback(async () => {
    setAlarms(await getAlarms());
    setStates(await getAllAlarmStates());
    setRide(await getRide());
    setRideState(await getRideState());
    setHasKey(!!(await getApiKey()));
    setNow(new Date());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => {
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [load]);

  const toggle = async (a: BusAlarm, enabled: boolean) => {
    await upsertAlarm({ ...a, enabled });
    await load();
    await applyMonitoringChanges();
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {!hasKey && (
        <Card style={{ borderColor: t.danger }}>
          <Text style={[styles.title, { color: t.danger }]}>API 키가 필요합니다</Text>
          <Muted>공공데이터포털(data.go.kr) 인증키를 설정에서 입력해야 버스 정보를 조회할 수 있습니다.</Muted>
          <Button title="설정으로 이동" onPress={() => router.push('/settings')} style={{ marginTop: 12 }} />
        </Card>
      )}

      <Card>
        <View style={styles.rowBetween}>
          <Text style={[styles.title, { color: t.text }]}>
            {status.running ? (status.mode === 'ride' ? '🟢 하차 알림 진행 중' : '🟢 백그라운드 감시 중') : '⚪ 감시 대기'}
          </Text>
          <Pressable onPress={() => router.push('/settings')} accessibilityRole="button">
            <Text style={{ color: t.primary, fontWeight: '700' }}>설정</Text>
          </Pressable>
        </View>
        {status.notice ? <Muted style={{ marginTop: 6 }}>{status.notice}</Muted> : null}
      </Card>

      <SectionTitle>하차 알림</SectionTitle>
      <Pressable onPress={() => router.push('/ride')}>
        <Card>
          {ride?.active ? (
            <>
              <Text style={[styles.title, { color: t.text }]}>🚏 {ride.stopName || ride.stopNo}</Text>
              <Muted>
                {ride.routeNo}번 탑승 ·{' '}
                {rideState?.lastCnt != null
                  ? rideState.lastCnt <= 0
                    ? '곧 도착'
                    : `${rideState.lastCnt}정거장 전`
                  : '버스 확인 중'}
              </Muted>
            </>
          ) : (
            <>
              <Text style={[styles.title, { color: t.text }]}>내릴 정류장 알림 설정</Text>
              <Muted>버스에 탄 뒤 내릴 정류장을 고르면 몇 정거장 전인지 알려드립니다.</Muted>
            </>
          )}
        </Card>
      </Pressable>

      <View style={styles.rowBetween}>
        <SectionTitle>버스 도착 알림</SectionTitle>
        <Pressable onPress={() => router.push('/alarm/new')} accessibilityRole="button">
          <Text style={{ color: t.primary, fontWeight: '700', fontSize: 15 }}>＋ 추가</Text>
        </Pressable>
      </View>

      {alarms.length === 0 && (
        <Card>
          <Text style={[styles.title, { color: t.text }]}>등록된 알림이 없습니다</Text>
          <Muted>정류장과 버스 노선, 감시 시간대를 지정해 도착 알림을 받아 보세요.</Muted>
          <Button title="알림 추가하기" onPress={() => router.push('/alarm/new')} style={{ marginTop: 12 }} />
        </Card>
      )}

      {alarms.map((a) => {
        const st = states[a.id];
        const win = a.enabled ? getActiveWindow(a, now) : null;
        const next = a.enabled && !win ? getNextWindowStart(a, now) : null;
        const showArrivals = win && st?.sessionKey === win.sessionKey;
        return (
          <Pressable key={a.id} onPress={() => router.push({ pathname: '/alarm/[id]', params: { id: a.id } })}>
            <Card style={{ opacity: a.enabled ? 1 : 0.6 }}>
              <View style={styles.rowBetween}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={[styles.title, { color: t.text }]}>{a.label || `${a.routes.join(', ')}번 버스`}</Text>
                  <Muted>
                    [{REGION_LABELS[a.region]}] {a.stopName || a.stopNo}
                  </Muted>
                </View>
                <Switch value={a.enabled} onValueChange={(v) => void toggle(a, v)} trackColor={{ true: t.primary }} />
              </View>
              <View style={styles.tags}>
                <Tag text={`${formatTime(a.windowStart)}~${formatTime(a.windowEnd)}`} />
                <Tag text={describeDays(a.days)} />
                <Tag text={describeAlertRule(a)} />
                <Tag text={`${a.pollIntervalSec}초 간격`} />
                {a.repeatIntervalMin > 0 && a.thresholdMin > 0 && <Tag text={`${a.repeatIntervalMin}분마다 반복`} />}
                <Tag text={a.routes.length ? `${a.routes.join(', ')}번` : '전체 노선'} />
              </View>
              {win ? (
                <View style={{ marginTop: 8 }}>
                  <Text style={{ color: t.success, fontWeight: '700' }}>● 지금 감시 중</Text>
                  {showArrivals && st.lastError ? <Muted style={{ color: t.danger }}>{st.lastError}</Muted> : null}
                  {showArrivals && !st.lastError && st.lastArrivals.length === 0 ? (
                    <Muted>도착 예정 버스 없음</Muted>
                  ) : null}
                  {showArrivals &&
                    st.lastArrivals.slice(0, 4).map((arr, i) => (
                      <Muted key={`${arr.routeNo}-${i}`}>
                        {arr.routeNo}번 · {arr.prevStationCnt}정거장 전 · {formatArrSec(arr.arrSec)} 후
                      </Muted>
                    ))}
                </View>
              ) : next ? (
                <Muted style={{ marginTop: 8 }}>
                  다음 감시: {next.getMonth() + 1}/{next.getDate()} ({'일월화수목금토'[next.getDay()]}){' '}
                  {formatTime({ hour: next.getHours(), minute: next.getMinutes() })}
                </Muted>
              ) : null}
            </Card>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function Tag({ text }: { text: string }) {
  const t = useTheme();
  return (
    <View style={[styles.tag, { backgroundColor: t.chip }]}>
      <Text style={{ color: t.text, fontSize: 12, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 17, fontWeight: '700', marginBottom: 2 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, gap: 6 },
  tag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
});
