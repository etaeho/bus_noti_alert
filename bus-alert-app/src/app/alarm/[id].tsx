import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button, Card, Chip, Field, Label, Muted, SectionTitle, Stepper, TimeStepper, ToggleRow, useTheme } from '../../components/ui';
import { fetchArrivals, lookupStop } from '../../core/busApi';
import { formatArrSec } from '../../core/format';
import { REGION_LABELS, TAGO_CITY_CODES, WEEKDAY_LABELS, type BusAlarm, type Region, type UnifiedArrival, type Weekday } from '../../core/types';
import { runOnceNow } from '../../services/monitor';
import { displayStopName, takePickedStop } from '../../services/pickerStore';
import { applyMonitoringChanges } from '../../services/runtime';
import { deleteAlarm, getAlarms, getApiKey, upsertAlarm } from '../../services/storage';

const REGIONS = Object.keys(REGION_LABELS) as Region[];
const STAGES = [5, 4, 3, 2, 1];

function newAlarm(): BusAlarm {
  return {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    label: '',
    enabled: true,
    region: 'daejeon',
    stopNo: '',
    stopName: '',
    stationId: '',
    cityCode: '',
    routes: [],
    windowStart: { hour: 7, minute: 0 },
    windowEnd: { hour: 7, minute: 30 },
    days: [1, 2, 3, 4, 5],
    stopAlerts: [3, 2],
    thresholdMin: 0,
    pollIntervalSec: 60,
    repeatIntervalMin: 0,
    sendStartSummary: true,
    createdAt: Date.now(),
  };
}

export default function AlarmEditScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const [a, setA] = useState<BusAlarm | null>(isNew ? newAlarm() : null);
  const [routesText, setRoutesText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [stopMsg, setStopMsg] = useState('');
  const [arrivals, setArrivals] = useState<UnifiedArrival[] | null>(null);
  const [availableRoutes, setAvailableRoutes] = useState<string[]>([]);
  const [manual, setManual] = useState(false);

  // 정류장 선택 화면에서 돌아오면 결과 반영
  useFocusEffect(
    useCallback(() => {
      const picked = takePickedStop('alarm');
      if (!picked) return;
      const { stop, direction } = picked;
      setA((prev) =>
        prev
          ? {
              ...prev,
              region: stop.region,
              cityCode: stop.cityCode,
              stopNo: stop.stopNo,
              stationId: stop.stationId,
              stopName: displayStopName(picked),
            }
          : prev,
      );
      setAvailableRoutes(direction?.routes ?? []);
      setStopMsg(direction?.routes.length ? '이 정류장을 지나는 노선을 아래에서 눌러 선택하세요.' : '');
    }, []),
  );

  useEffect(() => {
    if (isNew) return;
    (async () => {
      const found = (await getAlarms()).find((x) => x.id === id);
      if (found) {
        setA(found);
        setRoutesText(found.routes.join(', '));
      } else {
        setA(newAlarm());
      }
    })();
  }, [id, isNew]);

  if (!a) return <ActivityIndicator style={{ marginTop: 40 }} />;

  const set = (patch: Partial<BusAlarm>) => setA({ ...a, ...patch });
  const parseRoutes = (s: string) =>
    s
      .split(/[,\s]+/)
      .map((r) => r.trim())
      .filter(Boolean);
  const currentRoutes = parseRoutes(routesText);

  const toggleRoute = (r: string) => {
    const next = currentRoutes.includes(r) ? currentRoutes.filter((x) => x !== r) : [...currentRoutes, r];
    setRoutesText(next.join(', '));
  };
  const toggleStage = (n: number) => {
    const cur = a.stopAlerts ?? [];
    set({ stopAlerts: cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n].sort((x, y) => y - x) });
  };
  const toggleDay = (d: Weekday) =>
    set({ days: a.days.includes(d) ? a.days.filter((x) => x !== d) : ([...a.days, d].sort() as Weekday[]) });

  const checkStop = async () => {
    setBusy('stop');
    setStopMsg('');
    try {
      const key = await getApiKey();
      const info = await lookupStop(key, a.region, a.stopNo, a.cityCode);
      const updated = { ...a, stopNo: info.stopNo, stopName: info.stopName, stationId: info.stationId };
      setA(updated);
      setStopMsg(`✅ ${info.stopName}`);
      const arr = await fetchArrivals(key, { ...updated, routes: [] });
      setAvailableRoutes([...new Set(arr.map((x) => x.routeNo))].sort());
    } catch (e) {
      // 정류소정보 API 미신청이어도 도착정보 API 만으로 동작할 수 있음 (원본의 폴백 동작)
      try {
        const arr = await fetchArrivals(await getApiKey(), { ...a, stationId: '', routes: [] });
        setAvailableRoutes([...new Set(arr.map((x) => x.routeNo))].sort());
        if (arr[0] && !a.stopName) set({ stopName: arr[0].stopName });
        setStopMsg(`✅ 도착정보 조회 성공 (${arr.length}건). 정류장 이름은 직접 입력할 수 있습니다.`);
      } catch {
        setStopMsg(`⚠️ ${(e as Error).message}`);
      }
    } finally {
      setBusy(null);
    }
  };

  const build = (): BusAlarm | null => {
    const stopNo = a.stopNo.replace(/-/g, '').trim();
    if (!stopNo && !a.stationId) {
      Alert.alert('입력 확인', '정류장을 선택해 주세요.');
      return null;
    }
    if (!(a.stopAlerts ?? []).length && a.thresholdMin <= 0) {
      Alert.alert('알림 기준', "'몇 정거장 전' 또는 '도착 몇 분 전' 중 하나는 설정해 주세요.");
      return null;
    }
    return { ...a, stopNo, routes: currentRoutes, label: a.label.trim() };
  };

  const save = async () => {
    const alarm = build();
    if (!alarm) return;
    await upsertAlarm(alarm);
    await applyMonitoringChanges();
    router.back();
  };

  const testNow = async (notify: boolean) => {
    const alarm = build();
    if (!alarm) return;
    setBusy(notify ? 'notify' : 'check');
    try {
      setArrivals(await runOnceNow(alarm, notify));
    } catch (e) {
      Alert.alert('조회 실패', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = () =>
    Alert.alert('알림 삭제', '이 알림을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          await deleteAlarm(a.id);
          await applyMonitoringChanges();
          router.back();
        },
      },
    ]);

  const isTago = !!TAGO_CITY_CODES[a.region];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: isNew ? '새 버스 알림' : '버스 알림 수정' }} />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <SectionTitle>정류장 · 노선</SectionTitle>
        <Card>
          <Label>알림 이름</Label>
          <Field value={a.label} onChangeText={(v) => set({ label: v })} placeholder="예: 출근 311번" />

          <View style={{ height: 14 }} />
          <Label>정류장</Label>
          {a.stopName || a.stopNo ? (
            <View style={[styles.stopBox, { borderColor: t.border, backgroundColor: t.inputBg }]}>
              <Text style={{ color: t.text, fontSize: 16, fontWeight: '700' }}>🚏 {a.stopName || `정류소 ${a.stopNo}`}</Text>
              <Muted>
                {[REGION_LABELS[a.region], a.stopNo ? `번호 ${a.stopNo}` : ''].filter(Boolean).join(' · ')}
              </Muted>
            </View>
          ) : null}
          <Button
            title={a.stopName || a.stopNo ? '🔍 정류장 다시 찾기' : '🔍 정류장 이름 검색 / 지도에서 선택'}
            variant={a.stopName || a.stopNo ? 'secondary' : 'primary'}
            onPress={() =>
              router.push({
                pathname: '/stop-picker',
                params: { purpose: 'alarm', ...(a.stopNo || a.stationId ? { region: a.region } : {}) },
              })
            }
            style={{ marginTop: 8 }}
          />
          {stopMsg ? <Muted style={{ marginTop: 6 }}>{stopMsg}</Muted> : null}

          <Pressable onPress={() => setManual(!manual)} style={{ marginTop: 12 }}>
            <Text style={{ color: t.primary, fontWeight: '600' }}>
              {manual ? '▾' : '▸'} 정류소 번호로 직접 입력 (고급)
            </Text>
          </Pressable>
          {manual && (
            <View style={{ marginTop: 10 }}>
              <Label>권역</Label>
              <View style={styles.wrap}>
                {REGIONS.map((r) => (
                  <Chip
                    key={r}
                    label={REGION_LABELS[r]}
                    selected={a.region === r}
                    onPress={() => set({ region: r, stationId: '', cityCode: '' })}
                  />
                ))}
              </View>
              <Label hint="정류장 표지판의 번호 (서울 ARS 번호 / 경기 정류소 번호)">정류소 번호</Label>
              <View style={styles.row}>
                <Field
                  style={{ flex: 1 }}
                  value={a.stopNo}
                  onChangeText={(v) => set({ stopNo: v, stationId: '' })}
                  placeholder="예: 11690"
                  keyboardType="number-pad"
                />
                <Button
                  title={busy === 'stop' ? '확인 중…' : '정류장 확인'}
                  variant="secondary"
                  onPress={checkStop}
                  disabled={!!busy}
                  style={{ marginLeft: 8 }}
                />
              </View>
              <View style={{ height: 14 }} />
              <Label>정류장 이름 (표시용)</Label>
              <Field value={a.stopName} onChangeText={(v) => set({ stopName: v })} placeholder="자동 입력 또는 직접 입력" />
              {isTago && (
                <>
                  <View style={{ height: 14 }} />
                  <Label hint={`비워두면 기본값 ${TAGO_CITY_CODES[a.region]} 사용`}>TAGO 도시코드</Label>
                  <Field
                    value={a.cityCode}
                    onChangeText={(v) => set({ cityCode: v.trim() })}
                    placeholder={TAGO_CITY_CODES[a.region]}
                    keyboardType="number-pad"
                  />
                </>
              )}
            </View>
          )}

          <View style={{ height: 14 }} />
          <Label hint="쉼표로 구분. 비워두면 정류장의 모든 노선을 감시합니다.">버스 노선 번호</Label>
          <Field value={routesText} onChangeText={setRoutesText} placeholder="예: 311, 102" autoCapitalize="characters" />
          {availableRoutes.length > 0 && (
            <>
              <Muted style={{ marginTop: 8, marginBottom: 6 }}>이 정류장의 노선 (눌러서 선택)</Muted>
              <View style={styles.wrap}>
                {availableRoutes.map((r) => (
                  <Chip key={r} label={r} selected={currentRoutes.includes(r)} onPress={() => toggleRoute(r)} />
                ))}
              </View>
            </>
          )}
        </Card>

        <SectionTitle>알림 시간</SectionTitle>
        <Card>
          <View style={styles.timeRow}>
            <View style={{ alignItems: 'center' }}>
              <Muted>시작</Muted>
              <TimeStepper value={a.windowStart} onChange={(v) => set({ windowStart: v })} />
            </View>
            <Text style={{ color: t.sub, fontSize: 24 }}>~</Text>
            <View style={{ alignItems: 'center' }}>
              <Muted>종료</Muted>
              <TimeStepper value={a.windowEnd} onChange={(v) => set({ windowEnd: v })} />
            </View>
          </View>
          <Muted style={{ marginTop: 6 }}>종료가 시작보다 이르면 자정을 넘기는 시간대로 처리합니다.</Muted>

          <View style={{ height: 14 }} />
          <Label>반복 요일</Label>
          <View style={styles.wrap}>
            {WEEKDAY_LABELS.map((lbl, i) => (
              <Chip key={lbl} label={lbl} selected={a.days.includes(i as Weekday)} onPress={() => toggleDay(i as Weekday)} />
            ))}
          </View>
          <View style={styles.wrap}>
            <Chip label="평일" selected={false} onPress={() => set({ days: [1, 2, 3, 4, 5] })} />
            <Chip label="주말" selected={false} onPress={() => set({ days: [0, 6] })} />
            <Chip label="매일" selected={false} onPress={() => set({ days: [0, 1, 2, 3, 4, 5, 6] })} />
          </View>
        </Card>

        <SectionTitle>알림 방식</SectionTitle>
        <Card>
          <Label hint="여러 개 선택 가능 · 각 단계마다 한 번씩 알림">몇 정거장 전에 알릴까요?</Label>
          <View style={styles.wrap}>
            {STAGES.map((n) => (
              <Chip
                key={n}
                label={`${n}정거장 전`}
                selected={(a.stopAlerts ?? []).includes(n)}
                onPress={() => toggleStage(n)}
              />
            ))}
          </View>
          <View style={[styles.settingRow, { marginTop: 6 }]}>
            <View style={{ flex: 1 }}>
              <Label hint="버스가 이 시간 안으로 들어오면 알림 (0 = 사용 안 함)">도착 몇 분 전 (선택)</Label>
            </View>
            <Stepper value={a.thresholdMin} onChange={(v) => set({ thresholdMin: v })} min={0} max={30} unit="분" />
          </View>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Label hint="버스 정보를 확인하는 주기">조회 간격</Label>
            </View>
            <Stepper
              value={a.pollIntervalSec}
              onChange={(v) => set({ pollIntervalSec: v })}
              min={30}
              max={300}
              step={30}
              unit="초"
            />
          </View>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Label hint="'몇 분 전' 알림을 같은 버스 도착 전까지 N분마다 반복 (0 = 1번만)">반복 알림 간격</Label>
            </View>
            <Stepper
              value={a.repeatIntervalMin}
              onChange={(v) => set({ repeatIntervalMin: v })}
              min={0}
              max={10}
              unit="분"
            />
          </View>
          <ToggleRow
            label="감시 시작 시 현황 요약"
            hint="시간대가 시작되면 현재 가장 가까운 버스 정보를 1회 알림"
            value={a.sendStartSummary}
            onChange={(v) => set({ sendStartSummary: v })}
          />
          <ToggleRow label="알림 사용" value={a.enabled} onChange={(v) => set({ enabled: v })} />
        </Card>

        <Button title="저장" onPress={save} />
        <View style={styles.row}>
          <Button
            title={busy === 'check' ? '조회 중…' : '지금 조회'}
            variant="secondary"
            onPress={() => testNow(false)}
            disabled={!!busy}
            style={styles.half}
          />
          <Button
            title={busy === 'notify' ? '전송 중…' : '테스트 알림'}
            variant="secondary"
            onPress={() => testNow(true)}
            disabled={!!busy}
            style={[styles.half, { marginLeft: 8 }]}
          />
        </View>

        {arrivals && (
          <Card style={{ marginTop: 12 }}>
            <Label>현재 도착 정보</Label>
            {arrivals.length === 0 ? (
              <Muted>도착 예정인 버스가 없습니다.</Muted>
            ) : (
              arrivals.map((x, i) => (
                <View key={`${x.routeNo}-${i}`} style={{ marginBottom: 8 }}>
                  <Text style={{ color: t.text, fontWeight: '700' }}>
                    {x.routeNo}번 · {x.prevStationCnt}정거장 전 · {formatArrSec(x.arrSec)} 후
                  </Text>
                  {x.extraInfo ? <Muted>{x.extraInfo}</Muted> : null}
                </View>
              ))
            )}
          </Card>
        )}

        {!isNew && <Button title="알림 삭제" variant="danger" onPress={remove} style={{ marginTop: 24 }} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 60 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  half: { flex: 1 },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  settingRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  stopBox: { borderWidth: 1, borderRadius: 10, padding: 12 },
});
