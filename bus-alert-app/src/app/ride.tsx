import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Field, Label, Muted, SectionTitle, Stepper, useTheme } from '../components/ui';
import { distanceM } from '../core/decide';
import { REGION_LABELS, type RideAlert, type RideRuntimeState } from '../core/types';
import { requestLocationPermissions } from '../services/background';
import { displayStopName, takePickedStop } from '../services/pickerStore';
import { applyMonitoringChanges } from '../services/runtime';
import { getAlarms, getApiKey, getRide, getRideState, saveRide } from '../services/storage';

function defaultRide(): RideAlert {
  return {
    active: false,
    region: 'daejeon',
    stopNo: '',
    stopName: '',
    latitude: 0,
    longitude: 0,
    radiusM: 200,
    preAlertM: 800,
    repeatCount: 3,
    repeatIntervalSec: 20,
    startedAt: 0,
    routeNo: '',
  };
}

export default function RideScreen() {
  const t = useTheme();
  const [r, setR] = useState<RideAlert>(defaultRide());
  const [rs, setRs] = useState<RideRuntimeState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [here, setHere] = useState<{ latitude: number; longitude: number } | null>(null);

  const load = useCallback(async () => {
    const saved = await getRide();
    if (saved) setR(saved);
    else {
      // 최근 도착 알림의 권역을 기본값으로
      const alarms = await getAlarms();
      if (alarms[0]) setR((p) => ({ ...p, region: alarms[0].region }));
    }
    setRs(await getRideState());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 정류장 선택 화면에서 돌아오면 좌표까지 반영
  useFocusEffect(
    useCallback(() => {
      const picked = takePickedStop('ride');
      if (!picked) return;
      const { stop } = picked;
      setR((p) => ({
        ...p,
        region: stop.region,
        stopNo: stop.stopNo,
        stopName: displayStopName(picked),
        latitude: stop.latitude ?? p.latitude,
        longitude: stop.longitude ?? p.longitude,
      }));
      setMsg(
        stop.latitude && stop.longitude
          ? `✅ 하차 지점: ${stop.latitude.toFixed(5)}, ${stop.longitude.toFixed(5)}`
          : '⚠️ 이 정류장은 좌표 정보가 없습니다. 정류장에서 "현재 위치로 지정"을 사용해 주세요.',
      );
    }, []),
  );

  // 진행 중이면 화면에서 실시간 거리 표시
  useEffect(() => {
    if (!r.active) return;
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 10, timeInterval: 5000 },
        (loc) => setHere(loc.coords),
      );
    })();
    const id = setInterval(async () => {
      setRs(await getRideState());
      const saved = await getRide();
      if (saved && !saved.active) setR(saved);
    }, 4000);
    return () => {
      sub?.remove();
      clearInterval(id);
    };
  }, [r.active]);

  const set = (patch: Partial<RideAlert>) => setR({ ...r, ...patch });
  const hasCoords = r.latitude !== 0 && r.longitude !== 0;

  const useCurrentLocation = async () => {
    setBusy('loc');
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) throw new Error('위치 권한이 필요합니다.');
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      set({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      setMsg(`📍 현재 위치 (${loc.coords.latitude.toFixed(5)}, ${loc.coords.longitude.toFixed(5)})를 하차 지점으로 지정했습니다.`);
    } catch (e) {
      setMsg(`⚠️ ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    if (!hasCoords) {
      Alert.alert('하차 지점 필요', '정류장 조회 또는 좌표 입력으로 하차 지점을 지정해 주세요.');
      return;
    }
    const perm = await requestLocationPermissions();
    if (!perm.foreground) {
      Alert.alert('위치 권한 필요', '하차 알림은 위치 정보가 필요합니다.');
      return;
    }
    if (!perm.background) {
      Alert.alert(
        '백그라운드 위치 권한',
        '"항상 허용"이 아니면 앱이 화면에 열려 있을 때만 하차 알림이 동작합니다. 설정에서 위치 권한을 "항상 허용"으로 변경해 주세요.',
      );
    }
    const ride = { ...r, active: true, startedAt: Date.now() };
    await saveRide(ride);
    setR(ride);
    setRs(await getRideState());
    await applyMonitoringChanges();
  };

  const stop = async () => {
    const ride = { ...r, active: false };
    await saveRide(ride);
    setR(ride);
    await applyMonitoringChanges();
  };

  const liveDist =
    here && hasCoords ? Math.round(distanceM(here.latitude, here.longitude, r.latitude, r.longitude)) : rs?.lastDistanceM;

  if (r.active) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Card>
          <Muted>하차 알림 진행 중</Muted>
          <Text style={[styles.big, { color: t.text }]}>🚏 {r.stopName || r.stopNo}</Text>
          {r.routeNo ? <Muted>{r.routeNo}번 탑승 중</Muted> : null}
          <Text style={[styles.dist, { color: t.primary }]}>
            {liveDist != null ? (liveDist >= 1000 ? `${(liveDist / 1000).toFixed(1)}km` : `${liveDist}m`) : '위치 확인 중…'}
          </Text>
          <Muted>
            반경 {r.radiusM}m 안에 들어오면 {r.repeatCount}회 알림
            {r.preAlertM > r.radiusM ? ` · ${r.preAlertM}m 전 미리 알림` : ''}
          </Muted>
          {rs?.arrivedNotifyCount ? (
            <Muted style={{ marginTop: 6, color: t.success }}>도착 알림 {rs.arrivedNotifyCount}회 전송됨</Muted>
          ) : null}
        </Card>
        <Button title="하차 알림 종료" variant="danger" onPress={stop} />
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Muted style={{ marginBottom: 12 }}>
          버스에 탄 뒤 내릴 정류장을 지정하고 시작을 누르세요. GPS로 정류장 접근을 감지해 미리 알림과 도착 알림을 보내드립니다.
        </Muted>

        <SectionTitle>내릴 정류장</SectionTitle>
        <Card>
          {r.stopName ? (
            <View style={[styles.stopBox, { borderColor: t.border, backgroundColor: t.inputBg }]}>
              <Text style={{ color: t.text, fontSize: 16, fontWeight: '700' }}>🚏 {r.stopName}</Text>
              <Muted>{[REGION_LABELS[r.region], r.stopNo ? `번호 ${r.stopNo}` : ''].filter(Boolean).join(' · ')}</Muted>
            </View>
          ) : null}
          <Button
            title={r.stopName ? '🔍 정류장 다시 찾기' : '🔍 정류장 이름 검색 / 지도에서 선택'}
            variant={r.stopName ? 'secondary' : 'primary'}
            onPress={() => router.push({ pathname: '/stop-picker', params: { purpose: 'ride' } })}
            style={{ marginTop: 8 }}
          />
          <View style={{ height: 12 }} />
          <Label>정류장 이름</Label>
          <Field value={r.stopName} onChangeText={(v) => set({ stopName: v })} placeholder="표시용 이름" />
          <View style={{ height: 12 }} />
          <Label>탑승 노선 (선택)</Label>
          <Field value={r.routeNo} onChangeText={(v) => set({ routeNo: v.trim() })} placeholder="예: 311" />

          <View style={{ height: 12 }} />
          <Label hint="정류장 조회로 자동 입력되며, 직접 수정할 수 있습니다.">하차 지점 좌표</Label>
          <View style={styles.row}>
            <Field
              style={{ flex: 1 }}
              value={r.latitude ? String(r.latitude) : ''}
              onChangeText={(v) => set({ latitude: Number(v) || 0 })}
              placeholder="위도"
              keyboardType="decimal-pad"
            />
            <Field
              style={{ flex: 1, marginLeft: 8 }}
              value={r.longitude ? String(r.longitude) : ''}
              onChangeText={(v) => set({ longitude: Number(v) || 0 })}
              placeholder="경도"
              keyboardType="decimal-pad"
            />
          </View>
          <Button
            title={busy === 'loc' ? '위치 확인 중…' : '현재 위치로 지정'}
            variant="secondary"
            onPress={useCurrentLocation}
            disabled={!!busy}
            style={{ marginTop: 10 }}
          />
          {msg ? <Muted style={{ marginTop: 8 }}>{msg}</Muted> : null}
        </Card>

        <SectionTitle>알림 방식</SectionTitle>
        <Card>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Label hint="정류장 반경 안에 들어오면 '지금 내리세요' 알림">도착 반경</Label>
            </View>
            <Stepper value={r.radiusM} onChange={(v) => set({ radiusM: v })} min={50} max={1000} step={50} unit="m" />
          </View>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Label hint="이 거리에서 '곧 내릴 정류장' 예고 (0 = 끔)">미리 알림 거리</Label>
            </View>
            <Stepper value={r.preAlertM} onChange={(v) => set({ preAlertM: v })} min={0} max={3000} step={100} unit="m" />
          </View>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Label hint="도착 알림을 놓치지 않도록 반복">반복 횟수</Label>
            </View>
            <Stepper value={r.repeatCount} onChange={(v) => set({ repeatCount: v })} min={1} max={5} unit="회" />
          </View>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Label>반복 간격</Label>
            </View>
            <Stepper
              value={r.repeatIntervalSec}
              onChange={(v) => set({ repeatIntervalSec: v })}
              min={10}
              max={120}
              step={10}
              unit="초"
            />
          </View>
        </Card>

        <Button title="하차 알림 시작" onPress={start} disabled={!hasCoords} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 60 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center' },
  settingRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  big: { fontSize: 22, fontWeight: '800', marginVertical: 6 },
  stopBox: { borderWidth: 1, borderRadius: 10, padding: 12 },
  dist: { fontSize: 44, fontWeight: '800', marginVertical: 10, fontVariant: ['tabular-nums'] },
});
