/**
 * 알림 설정 탭: 처음 설정 안내 · 지금 감시 중인 정류장의 실시간 정보 · 버스 알림 목록
 */
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { HeroHeader, HeroPill } from '../../components/HeroHeader';
import { LiveArrivals } from '../../components/LiveArrivals';
import { Button, Card, EmptyState, Fab, Icon, ListRow, Muted, Pill, RouteBadge, SectionTitle, useTheme } from '../../components/ui';
import { describeAlertRule } from '../../core/format';
import { describeDays, formatTime, getActiveWindow, getNextWindowStart } from '../../core/schedule';
import { REGION_LABELS, type AlarmRuntimeState, type BusAlarm, type RideAlert, type RideRuntimeState } from '../../core/types';
import { requestLocationPermissions } from '../../services/background';
import { ensureNotificationPermission } from '../../services/notify';
import { applyMonitoringChanges, useMonitoringStatus } from '../../services/runtime';
import {
  getAlarms,
  getAllAlarmStates,
  getApiKey,
  getHistory,
  getRide,
  getRideState,
  upsertAlarm,
  type HistoryEntry,
} from '../../services/storage';

interface Setup {
  apiKey: boolean;
  notifications: boolean;
  background: boolean;
}

function nextLabel(d: Date, now: Date): string {
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toDateString() === d.toDateString();
  const day = sameDay ? '오늘' : tomorrow ? '내일' : `${d.getMonth() + 1}/${d.getDate()}(${'일월화수목금토'[d.getDay()]})`;
  return `${day} ${formatTime({ hour: d.getHours(), minute: d.getMinutes() })}`;
}

export default function AlarmsScreen() {
  const t = useTheme();
  const status = useMonitoringStatus();
  const [alarms, setAlarms] = useState<BusAlarm[]>([]);
  const [states, setStates] = useState<Record<string, AlarmRuntimeState>>({});
  const [ride, setRide] = useState<RideAlert | null>(null);
  const [rideState, setRideState] = useState<RideRuntimeState | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [now, setNow] = useState(new Date());
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [al, st, rd, rds, hist, key] = await Promise.all([
      getAlarms(),
      getAllAlarmStates(),
      getRide(),
      getRideState(),
      getHistory(),
      getApiKey(),
    ]);
    setAlarms(al);
    setStates(st);
    setRide(rd);
    setRideState(rds);
    const [np, bp] = await Promise.all([
      Notifications.getPermissionsAsync().catch(() => null),
      Location.getBackgroundPermissionsAsync().catch(() => null),
    ]);
    setSetup({ apiKey: !!key, notifications: !!np?.granted, background: !!bp?.granted });
    setNow(new Date());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => {
    const id = setInterval(() => void load(), 10_000);
    return () => clearInterval(id);
  }, [load]);

  const toggle = async (a: BusAlarm, enabled: boolean) => {
    await upsertAlarm({ ...a, enabled });
    await load();
    await applyMonitoringChanges();
  };

  const activeAlarms = alarms.filter((a) => a.enabled && getActiveWindow(a, now));
  const setupDone = setup ? setup.apiKey && setup.notifications && setup.background && alarms.length > 0 : true;
  const today = `${now.getMonth() + 1}월 ${now.getDate()}일 ${'일월화수목금토'[now.getDay()]}요일`;

  const statusLive = !!ride?.active || activeAlarms.length > 0;
  const statusText = ride?.active
    ? '하차 알림 중'
    : activeAlarms.length
      ? `${activeAlarms.length}개 감시 중`
      : alarms.some((a) => a.enabled)
        ? status.running
          ? '대기 중 · 백그라운드 ON'
          : '대기 중'
        : '켜진 알림 없음';

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <HeroHeader title="알림 설정" subtitle={today} right={<HeroPill text={statusText} tone={statusLive ? 'live' : 'neutral'} />} />
        <View style={styles.body}>
        {setup && !setupDone ? (
          <Card>
            <Text style={[styles.cardTitle, { color: t.text }]}>처음 설정하기</Text>
            <Muted style={{ marginBottom: 4 }}>아래 단계를 마치면 앱을 닫아도 알림을 받을 수 있습니다.</Muted>
            <ListRow
              icon={setup.apiKey ? 'checkmark-circle' : 'key'}
              iconColor={setup.apiKey ? t.success : t.warning}
              title="1. 공공데이터 API 키 입력"
              subtitle={setup.apiKey ? '완료' : '버스 정보를 불러오는 데 필요합니다'}
              onPress={() => router.push('/settings')}
            />
            <ListRow
              icon={setup.notifications ? 'checkmark-circle' : 'notifications'}
              iconColor={setup.notifications ? t.success : t.warning}
              title="2. 알림 허용"
              subtitle={setup.notifications ? '완료' : '눌러서 허용'}
              onPress={async () => {
                await ensureNotificationPermission();
                await load();
              }}
            />
            <ListRow
              icon={setup.background ? 'checkmark-circle' : 'location'}
              iconColor={setup.background ? t.success : t.warning}
              title='3. 위치 "항상 허용"'
              subtitle={setup.background ? '완료' : '앱을 닫아도 감시하려면 필요합니다'}
              onPress={async () => {
                await requestLocationPermissions();
                await applyMonitoringChanges();
                await load();
              }}
            />
            <ListRow
              icon={alarms.length ? 'checkmark-circle' : 'add-circle'}
              iconColor={alarms.length ? t.success : t.warning}
              title="4. 첫 버스 알림 만들기"
              subtitle={alarms.length ? '완료' : '정류장과 시간을 정해 주세요'}
              onPress={() => router.push('/alarm/new')}
              last
            />
          </Card>
        ) : null}

        {ride?.active ? (
          <Card onPress={() => router.push('/ride')}>
            <View style={styles.rowBetween}>
              <Pill text="하차 알림" tone="success" icon="flag" />
              <Icon name="chevron-forward" color={t.sub} size={18} />
            </View>
            <Text style={[styles.cardTitle, { color: t.text, marginTop: 8 }]}>
              {ride.routeNo}번 → {ride.stopName || ride.stopNo}
            </Text>
            <Text style={[styles.big, { color: t.success }]}>
              {rideState?.lastCnt != null ? (rideState.lastCnt <= 0 ? '곧 도착' : `${rideState.lastCnt}정거장 전`) : '버스 확인 중…'}
            </Text>
          </Card>
        ) : null}

        {activeAlarms.map((a) => (
          <Card key={`live-${a.id}`}>
            <View style={styles.rowBetween}>
              <Pill text="지금 감시 중" tone="success" icon="radio" />
              <Muted>~{formatTime(a.windowEnd)}</Muted>
            </View>
            <Text style={[styles.cardTitle, { color: t.text, marginTop: 8 }]}>{a.label || a.stopName || a.stopNo}</Text>
            <Muted>
              {a.stopName || a.stopNo} · {describeAlertRule(a)}
            </Muted>
            <LiveArrivals
              query={{ region: a.region, stopNo: a.stopNo, stationId: a.stationId, cityCode: a.cityCode, stopName: a.stopName }}
              highlight={a.routes}
              maxRows={4}
              pinHighlighted
            />
          </Card>
        ))}

        {!ride?.active ? (
          <Card style={{ paddingVertical: 4 }}>
            <ListRow
              icon="flag-outline"
              title="하차 알림"
              subtitle="버스에 탄 뒤 내릴 정류장 몇 정거장 전에 알려 드려요"
              onPress={() => router.push('/ride')}
              last
            />
          </Card>
        ) : null}

        <SectionTitle
          right={
            alarms.length ? (
              <Pressable onPress={() => router.push('/alarm/new')} hitSlop={10}>
                <Text style={{ color: t.primary, fontWeight: '700' }}>추가</Text>
              </Pressable>
            ) : null
          }
        >
          버스 도착 알림
        </SectionTitle>

        {alarms.length === 0 ? (
          <Card>
            <EmptyState
              icon="bus-outline"
              title="등록된 알림이 없습니다"
              body={'자주 타는 정류장과 버스를 등록하면\n"3정거장 전", "2정거장 전"에 알려 드립니다.'}
              action={<Button title="알림 만들기" icon="add" onPress={() => router.push('/alarm/new')} />}
            />
          </Card>
        ) : null}

        {alarms.map((a) => {
          const st = states[a.id];
          const win = a.enabled ? getActiveWindow(a, now) : null;
          const next = a.enabled && !win ? getNextWindowStart(a, now) : null;
          return (
            <Card
              key={a.id}
              onPress={() => router.push({ pathname: '/alarm/[id]', params: { id: a.id } })}
              style={{ opacity: a.enabled ? 1 : 0.55 }}
            >
              <View style={styles.rowBetween}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', flex: 1 }}>
                  {a.routes.length ? (
                    a.routes.slice(0, 4).map((r) => <RouteBadge key={r} route={r} active={!!win} />)
                  ) : (
                    <RouteBadge route="전체 노선" active={!!win} />
                  )}
                  {a.routes.length > 4 ? <RouteBadge route={`+${a.routes.length - 4}`} /> : null}
                </View>
                <Switch value={a.enabled} onValueChange={(v) => void toggle(a, v)} trackColor={{ true: t.primary }} />
              </View>
              {a.label ? <Text style={[styles.cardTitle, { color: t.text }]}>{a.label}</Text> : null}
              <View style={styles.meta}>
                <Icon name="location" size={15} color={t.sub} />
                <Text style={[styles.metaText, { color: t.text }]} numberOfLines={1}>
                  {a.stopName || a.stopNo} <Text style={{ color: t.sub }}>· {REGION_LABELS[a.region]}</Text>
                </Text>
              </View>
              <View style={styles.meta}>
                <Icon name="time" size={15} color={t.sub} />
                <Text style={[styles.metaText, { color: t.text }]}>
                  {formatTime(a.windowStart)}~{formatTime(a.windowEnd)} · {describeDays(a.days)}
                </Text>
              </View>
              <View style={styles.meta}>
                <Icon name="notifications" size={15} color={t.sub} />
                <Text style={[styles.metaText, { color: t.text }]}>{describeAlertRule(a)}</Text>
              </View>
              <View style={{ marginTop: 8 }}>
                {win ? (
                  <Pill text="지금 감시 중" tone="success" icon="radio" />
                ) : next ? (
                  <Pill text={`다음 감시 ${nextLabel(next, now)}`} tone="primary" icon="calendar" />
                ) : !a.enabled ? (
                  <Pill text="꺼짐" />
                ) : null}
              </View>
              {win && st?.lastError ? <Muted style={{ color: t.danger, marginTop: 6 }}>{st.lastError}</Muted> : null}
            </Card>
          );
        })}

        <View style={{ height: 80 }} />
        </View>
      </ScrollView>
      {alarms.length > 0 ? <Fab label="알림 추가" onPress={() => router.push('/alarm/new')} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: 24 },
  body: { paddingHorizontal: 16, paddingTop: 8 },
  header: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 14 },
  date: { fontSize: 13, fontWeight: '700' },
  h1: { fontSize: 28, fontWeight: '800', marginTop: 2 },
  cardTitle: { fontSize: 17, fontWeight: '700', marginBottom: 2 },
  big: { fontSize: 30, fontWeight: '800', marginTop: 4, fontVariant: ['tabular-nums'] },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  meta: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  metaText: { marginLeft: 6, fontSize: 14, flex: 1 },
});
