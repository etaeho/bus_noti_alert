/**
 * 하차 알림: 내릴 정류장 + 타고 있는 노선을 고르면,
 * 그 정류장의 도착정보로 내 버스가 N정거장 전일 때 알리고 도착 직전 "지금 내리세요".
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { HeroHeader } from '../../components/HeroHeader';
import { LiveArrivals } from '../../components/LiveArrivals';
import { Button, Card, Chip, Field, Label, Muted, SectionTitle, ToggleRow, useTheme } from '../../components/ui';
import { formatArrSec } from '../../core/format';
import { REGION_LABELS, type RideAlert, type RideRuntimeState } from '../../core/types';
import { requestLocationPermissions } from '../../services/background';
import { ensureNotificationPermission } from '../../services/notify';
import { displayStopName, takePickedStop } from '../../services/pickerStore';
import { runMonitorTick } from '../../services/monitor';
import { applyMonitoringChanges } from '../../services/runtime';
import { getAlarms, getRide, getRideState, saveRide, saveRideState } from '../../services/storage';

const STAGES = [5, 4, 3, 2, 1];

function defaultRide(): RideAlert {
  return {
    active: false,
    region: 'daejeon',
    cityCode: '',
    stopNo: '',
    stationId: '',
    stopName: '',
    routeNo: '',
    stopAlerts: [3, 2, 1],
    arriveAlert: true,
    pollIntervalSec: 30,
    startedAt: 0,
  };
}

export default function RideScreen() {
  const t = useTheme();
  const [r, setR] = useState<RideAlert>(defaultRide());
  const [rs, setRs] = useState<RideRuntimeState | null>(null);
  const [routes, setRoutes] = useState<string[]>([]);

  const load = useCallback(async () => {
    const saved = await getRide();
    if (saved) setR(saved);
    else {
      const alarms = await getAlarms();
      if (alarms[0]) setR((p) => ({ ...p, region: alarms[0].region }));
    }
    setRs(await getRideState());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 정류장 선택 화면에서 돌아오면 반영
  useFocusEffect(
    useCallback(() => {
      const picked = takePickedStop('ride');
      if (!picked) return;
      const { stop, direction } = picked;
      setR((p) => ({
        ...p,
        region: stop.region,
        cityCode: stop.cityCode,
        stopNo: stop.stopNo,
        stationId: stop.stationId,
        stopName: displayStopName(picked),
      }));
      setRoutes(direction?.routes ?? []);
    }, []),
  );

  // 진행 중이면 상태 새로고침
  useEffect(() => {
    if (!r.active) return;
    const id = setInterval(async () => {
      setRs(await getRideState());
      const saved = await getRide();
      if (saved && !saved.active) setR(saved);
    }, 4000);
    return () => clearInterval(id);
  }, [r.active]);

  const set = (patch: Partial<RideAlert>) => setR({ ...r, ...patch });
  const toggleStage = (s: number) =>
    set({ stopAlerts: r.stopAlerts.includes(s) ? r.stopAlerts.filter((x) => x !== s) : [...r.stopAlerts, s] });

  const start = async () => {
    if (!r.stopNo && !r.stationId) {
      Alert.alert('정류장 필요', '내릴 정류장을 선택해 주세요.');
      return;
    }
    if (!r.routeNo.trim()) {
      Alert.alert('노선 필요', '타고 있는 버스 노선 번호를 입력해 주세요.');
      return;
    }
    await ensureNotificationPermission();
    // 앱을 닫아도 계속 확인하려면 백그라운드 실행(위치 서비스)이 필요
    const perm = await requestLocationPermissions();
    if (!perm.background) {
      Alert.alert(
        '백그라운드 실행 권한',
        '위치 권한을 "항상 허용"으로 해야 앱을 닫아도 하차 알림이 계속 동작합니다. (위치는 앱이 꺼지지 않게 유지하는 용도로만 사용합니다)',
      );
    }
    const ride = { ...r, routeNo: r.routeNo.trim(), active: true, startedAt: Date.now() };
    await saveRide(ride);
    setR(ride);
    await applyMonitoringChanges();
    await runMonitorTick({ source: 'foreground' });
    setRs(await getRideState());
  };

  const stop = async () => {
    const ride = { ...r, active: false };
    await saveRide(ride);
    setR(ride);
    await applyMonitoringChanges();
  };

  const nextBus = async () => {
    const cur = rs ?? (await getRideState());
    await saveRideState({
      ...cur,
      trackedPlate: '',
      lastCnt: null,
      lastArrSec: null,
      notifiedStages: [],
      arrivedNotified: false,
      skipBuses: (cur.skipBuses ?? 0) + 1,
      lastPolledAt: 0,
    });
    await runMonitorTick({ source: 'foreground' });
    setRs(await getRideState());
  };

  if (r.active) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <HeroHeader title="하차 알림" subtitle="내릴 정류장 몇 정거장 전에 알려드려요" />
        <View style={{ padding: 16 }}>
        <Card>
          <Muted>하차 알림 진행 중</Muted>
          <Text style={[styles.big, { color: t.text }]}>
            {r.routeNo}번 → 🚏 {r.stopName || r.stopNo}
          </Text>
          <Text style={[styles.dist, { color: t.primary }]}>
            {rs?.lastCnt != null ? (rs.lastCnt <= 0 ? '곧 도착' : `${rs.lastCnt}정거장 전`) : '버스 확인 중…'}
          </Text>
          {rs?.lastArrSec != null ? <Muted>약 {formatArrSec(rs.lastArrSec)} 후 도착 예정</Muted> : null}
          {rs?.trackedPlate ? <Muted>추적 중인 차량: {rs.trackedPlate}</Muted> : null}
          {rs?.lastError ? <Muted style={{ color: t.danger, marginTop: 6 }}>{rs.lastError}</Muted> : null}
          <Muted style={{ marginTop: 8 }}>
            알림: {[...r.stopAlerts].sort((a, b) => b - a).map((s) => `${s}정거장 전`).join(', ')}
            {r.arriveAlert ? ', 도착 시 "지금 내리세요"' : ''}
          </Muted>
          {rs?.notifiedStages.length ? (
            <Muted style={{ color: t.success }}>
              보낸 알림: {[...rs.notifiedStages].sort((a, b) => b - a).map((s) => `${s}정거장 전`).join(', ')}
            </Muted>
          ) : null}
        </Card>
        <LiveArrivals
          query={{ region: r.region, stopNo: r.stopNo, stationId: r.stationId, cityCode: r.cityCode, stopName: r.stopName }}
          highlight={[r.routeNo]}
          maxRows={5}
          pinHighlighted
        />
        <View style={{ height: 12 }} />
        <Muted style={{ marginBottom: 8 }}>
          내가 탄 버스가 아닌 앞 버스가 잡혔다면(남은 정거장 수가 너무 적으면) 아래 버튼으로 다음 버스로 바꾸세요.
        </Muted>
        <Button title="다음 버스로 바꾸기" icon="swap-horizontal" variant="secondary" onPress={nextBus} />
        <Button title="하차 알림 종료" icon="stop-circle" variant="danger" onPress={stop} style={{ marginTop: 10 }} />
      </View>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <HeroHeader title="하차 알림" subtitle="내릴 정류장 몇 정거장 전에 알려드려요" />
        <View style={{ padding: 16 }}>
        <Muted style={{ marginBottom: 12 }}>
          버스에 탄 뒤 내릴 정류장과 노선을 고르고 시작을 누르세요. 내 버스가 내릴 정류장 몇 정거장 전에 왔는지 알려 드립니다.
        </Muted>

        <SectionTitle>① 내릴 정류장 · 타고 있는 노선</SectionTitle>
        <Card>
          {r.stopName || r.stopNo ? (
            <View style={[styles.stopBox, { borderColor: t.border, backgroundColor: t.inputBg }]}>
              <Text style={{ color: t.text, fontSize: 16, fontWeight: '700' }}>🚏 {r.stopName || `정류소 ${r.stopNo}`}</Text>
              <Muted>{[REGION_LABELS[r.region], r.stopNo ? `번호 ${r.stopNo}` : ''].filter(Boolean).join(' · ')}</Muted>
            </View>
          ) : null}
          <Button
            title={r.stopName || r.stopNo ? '🔍 정류장 다시 찾기' : '🔍 정류장 이름 검색 / 지도에서 선택'}
            variant={r.stopName || r.stopNo ? 'secondary' : 'primary'}
            onPress={() => router.push({ pathname: '/stop-picker', params: { purpose: 'ride' } })}
            style={{ marginTop: 8 }}
          />
          <LiveArrivals
            query={
              r.stopNo || r.stationId
                ? { region: r.region, stopNo: r.stopNo, stationId: r.stationId, cityCode: r.cityCode, stopName: r.stopName }
                : null
            }
            highlight={r.routeNo ? [r.routeNo] : []}
            onRoutePress={(rt) => set({ routeNo: rt })}
          />

          <View style={{ height: 14 }} />
          <Label>타고 있는 버스 노선</Label>
          <Field value={r.routeNo} onChangeText={(v) => set({ routeNo: v })} placeholder="예: 311" autoCapitalize="characters" />
          {routes.length > 0 && (
            <View style={[styles.wrap, { marginTop: 8 }]}>
              {routes.map((rt) => (
                <Chip key={rt} label={rt} selected={r.routeNo === rt} onPress={() => set({ routeNo: rt })} />
              ))}
            </View>
          )}
        </Card>

        <SectionTitle>② 알림 방식</SectionTitle>
        <Card>
          <Label hint="여러 개 선택 가능">내릴 정류장 몇 정거장 전에 알릴까요?</Label>
          <View style={styles.wrap}>
            {STAGES.map((s) => (
              <Chip key={s} label={`${s}정거장 전`} selected={r.stopAlerts.includes(s)} onPress={() => toggleStage(s)} />
            ))}
          </View>
          <ToggleRow
            label='도착 직전 "지금 내리세요" 알림'
            value={r.arriveAlert}
            onChange={(v) => set({ arriveAlert: v })}
          />
        </Card>

        <Button title="하차 알림 시작" icon="play" onPress={start} disabled={!(r.stopNo || r.stationId) || !r.routeNo.trim()} />
      </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: 60 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 },
  stopBox: { borderWidth: 1, borderRadius: 10, padding: 12 },
  big: { fontSize: 20, fontWeight: '800', marginVertical: 6 },
  dist: { fontSize: 40, fontWeight: '800', marginVertical: 10, fontVariant: ['tabular-nums'] },
});
