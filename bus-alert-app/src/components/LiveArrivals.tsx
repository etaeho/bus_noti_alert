/**
 * 정류장 실시간 도착 정보
 *  - 노선별로 묶어 "이번 버스 / 다음 버스"를 보여 줌 (국내 버스 앱 방식)
 *  - 노선 종류별 색상 · N초마다 자동 새로고침 (화면이 보일 때만)
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { fetchArrivals, type ArrivalQuery } from '../core/busApi';
import { routeStyle } from '../core/routeStyle';
import type { StopCandidate, StopDirection, UnifiedArrival } from '../core/types';
import { attachDirections, resolveDirection } from '../services/directionCache';
import { getApiKey } from '../services/storage';
import { Icon, Muted, useTheme } from './ui';

export interface LiveArrivalsProps {
  /** 조회할 정류장 (null 이면 표시 안 함) */
  query: Omit<ArrivalQuery, 'routes'> | null;
  /** 강조할 노선 (선택된 노선) */
  highlight?: string[];
  /** 노선 줄을 누르면 호출 (노선 선택용) */
  onRoutePress?: (routeNo: string) => void;
  intervalSec?: number;
  /** 최대 노선 수 */
  maxRows?: number;
  /** 즐겨찾기 목록용 작은 표시 (테두리·제목 없이) */
  compact?: boolean;
  /** 강조한 노선을 맨 위에 고정 (선택용 목록에서는 끔: 누를 때 순서가 바뀌면 헷갈림) */
  pinHighlighted?: boolean;
}

interface RouteGroup {
  routeNo: string;
  routeType?: string;
  buses: UnifiedArrival[];
}

function eta(sec: number): string {
  if (sec <= 60) return '곧 도착';
  const m = Math.round(sec / 60);
  return `${m}분`;
}

function stopsLabel(cnt: string): string {
  const m = cnt.match(/\d+/);
  if (!m) return '';
  return Number(m[0]) === 0 ? '' : `${m[0]}정거장 전`;
}

function group(list: UnifiedArrival[]): RouteGroup[] {
  const map = new Map<string, RouteGroup>();
  for (const a of [...list].sort((x, y) => x.arrSec - y.arrSec)) {
    const g = map.get(a.routeNo) ?? { routeNo: a.routeNo, routeType: a.routeType, buses: [] };
    g.buses.push(a);
    map.set(a.routeNo, g);
  }
  return [...map.values()];
}

function stopOf(q: Omit<ArrivalQuery, 'routes'>): StopCandidate {
  return {
    region: q.region,
    stopNo: q.stopNo,
    stationId: q.stationId ?? '',
    cityCode: q.cityCode ?? '',
    stopName: q.stopName ?? '',
  };
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString('ko-KR', { hour12: false });
}

export function LiveArrivals({
  query,
  highlight = [],
  onRoutePress,
  intervalSec = 15,
  maxRows = 12,
  compact = false,
  pinHighlighted = false,
}: LiveArrivalsProps) {
  const t = useTheme();
  const [rows, setRows] = useState<UnifiedArrival[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [focused, setFocused] = useState(true);
  const seq = useRef(0);
  const [dir, setDir] = useState<StopDirection | null>(null);
  const key = query ? `${query.region}|${query.stationId}|${query.stopNo}|${query.cityCode ?? ''}` : '';

  const load = useCallback(async () => {
    if (!query) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const list = await attachDirections(stopOf(query), await fetchArrivals(await getApiKey(), { ...query, routes: [] }));
      if (my !== seq.current) return;
      setRows(list);
      setError('');
      setUpdatedAt(new Date());
    } catch (e) {
      if (my !== seq.current) return;
      setError((e as Error).message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  useEffect(() => {
    if (!query || !focused) return;
    void load();
    const id = setInterval(() => {
      if (AppState.currentState === 'active') void load();
    }, intervalSec * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, focused, intervalSec, load]);

  useEffect(() => {
    setRows(null);
    setError('');
    setDir(null);
    if (!query) return;
    // 버스별 방면 (TAGO 지역은 주변 정류장 도착정보로 판별, 결과는 기기에 저장)
    let alive = true;
    void resolveDirection(stopOf(query), undefined, 6 * 3600_000)
      .then((d) => alive && setDir(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!query) return null;

  const hl = new Set(highlight.map((h) => h.toUpperCase()));
  const groups = group(rows ?? []).sort((a, b) => {
    if (pinHighlighted) {
      const ah = hl.has(a.routeNo.toUpperCase()) ? 0 : 1;
      const bh = hl.has(b.routeNo.toUpperCase()) ? 0 : 1;
      if (ah !== bh) return ah - bh;
    }
    // 노선을 눌러 선택하는 목록은 번호순으로 고정 (새로고침해도 자리가 바뀌지 않게)
    if (onRoutePress) return a.routeNo.localeCompare(b.routeNo, 'ko', { numeric: true });
    return a.buses[0].arrSec - b.buses[0].arrSec;
  });

  const body = (
    <>
      {error ? (
        <View style={[styles.notice, { backgroundColor: t.dangerSoft }]}>
          <Icon name="alert-circle" size={16} color={t.danger} />
          <Text style={{ color: t.danger, marginLeft: 6, flex: 1, fontSize: 13 }}>{error}</Text>
        </View>
      ) : null}
      {rows && rows.length === 0 && !error ? (
        <View style={styles.emptyRow}>
          <Icon name="moon-outline" size={18} color={t.sub} />
          <Text style={{ color: t.sub, marginLeft: 8 }}>지금 도착 예정인 버스가 없습니다</Text>
        </View>
      ) : null}
      {!rows && !error
        ? [0, 1, compact ? -1 : 2].filter((i) => i >= 0).map((i) => (
            <View key={i} style={[styles.skeleton, { backgroundColor: t.chip }]} />
          ))
        : null}

      {groups.slice(0, maxRows).map((g, i) => {
        const on = hl.has(g.routeNo.toUpperCase());
        const rs = routeStyle(g.routeType, g.routeNo);
        const first = g.buses[0];
        const second = g.buses[1];
        const soon = first.arrSec <= 120;
        const plate = first.vehicleIdOrPlate;
        const seats = first.extraInfo.match(/잔여좌석: (\d+)석/)?.[1];
        return (
          <Pressable
            key={g.routeNo}
            onPress={onRoutePress ? () => onRoutePress(g.routeNo) : undefined}
            style={[
              styles.row,
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.border },
              on && { backgroundColor: t.primarySoft },
            ]}
          >
            <View style={[styles.bar, { backgroundColor: rs.color }]} />
            <View style={{ flex: 1 }}>
              <View style={styles.routeLine}>
                <Text style={[styles.routeNo, { color: rs.color }]}>{g.routeNo}</Text>
                <Text style={[styles.routeType, { color: t.sub }]}>{rs.label}</Text>
              </View>
              {(() => {
                const dirText = first.direction ?? dir?.routeDirections?.[g.routeNo] ?? (dir?.label || '');
                if (dirText) {
                  return (
                    <Text style={{ color: t.primary, fontSize: compact ? 12 : 12.5, fontWeight: '700', marginTop: 1 }} numberOfLines={1}>
                      → {dirText}
                    </Text>
                  );
                }
                // 방면을 모르면 노선의 기점 ↔ 종점
                const ends = dir?.routeEnds?.[g.routeNo];
                return ends ? (
                  <Text style={{ color: t.sub, fontSize: 12, marginTop: 1 }} numberOfLines={1}>
                    {ends}
                  </Text>
                ) : null;
              })()}
              {!compact && (plate || seats) ? (
                <Text style={{ color: t.sub, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {[plate, seats ? `좌석 ${seats}` : ''].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.eta, { color: soon ? t.danger : t.text }]}>{eta(first.arrSec)}</Text>
              <Text style={{ color: t.sub, fontSize: 12 }}>
                {stopsLabel(first.prevStationCnt)}
                {second ? `  ·  다음 ${eta(second.arrSec)}` : ''}
              </Text>
            </View>
            {onRoutePress ? (
              <View style={[styles.check, { borderColor: on ? t.primary : t.border, backgroundColor: on ? t.primary : 'transparent' }]}>
                {on ? <Icon name="checkmark" size={14} color="#fff" /> : null}
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </>
  );

  if (compact) {
    return (
      <View style={{ marginTop: 8 }}>
        {body}
        {updatedAt ? <Muted style={{ marginTop: 4, fontSize: 11 }}>{timeLabel(updatedAt)} 기준</Muted> : null}
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { backgroundColor: t.card, shadowColor: t.shadow }]}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={[styles.liveDot, { backgroundColor: error ? t.danger : t.success }]} />
          <Text style={[styles.title, { color: t.text }]}>실시간 도착 정보</Text>
        </View>
        <Pressable onPress={() => void load()} hitSlop={10} accessibilityRole="button" accessibilityLabel="새로고침">
          {loading ? <ActivityIndicator size="small" /> : <Icon name="refresh" size={20} color={t.primary} />}
        </Pressable>
      </View>
      {body}
      <Muted style={{ marginTop: 8, fontSize: 12 }}>
        {updatedAt ? `${timeLabel(updatedAt)} 기준 · ${intervalSec}초마다 자동 갱신` : ''}
        {onRoutePress ? ' · 노선을 누르면 선택/해제' : ''}
      </Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 20,
    padding: 14,
    marginTop: 12,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  title: { fontSize: 16, fontWeight: '900' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingRight: 4, borderRadius: 10 },
  bar: { width: 4, alignSelf: 'stretch', borderRadius: 2, marginRight: 10 },
  routeLine: { flexDirection: 'row', alignItems: 'baseline' },
  routeNo: { fontSize: 19, fontWeight: '900' },
  routeType: { fontSize: 12, fontWeight: '700', marginLeft: 6 },
  eta: { fontSize: 19, fontWeight: '900', fontVariant: ['tabular-nums'] },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginLeft: 10 },
  skeleton: { height: 44, borderRadius: 10, marginVertical: 5 },
  notice: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 10, marginVertical: 4 },
  emptyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
});
