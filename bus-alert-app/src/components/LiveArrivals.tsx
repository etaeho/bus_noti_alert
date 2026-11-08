/**
 * 정류장 실시간 도착 정보 (N초마다 자동 새로고침, 화면이 보일 때만)
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { fetchArrivals, type ArrivalQuery } from '../core/busApi';
import { formatArrSec } from '../core/format';
import type { UnifiedArrival } from '../core/types';
import { getApiKey } from '../services/storage';
import { Muted, useTheme } from './ui';

export interface LiveArrivalsProps {
  /** 조회할 정류장 (null 이면 표시 안 함) */
  query: Omit<ArrivalQuery, 'routes'> | null;
  /** 강조할 노선 (선택된 노선) */
  highlight?: string[];
  /** 노선 줄을 누르면 호출 (노선 선택용) */
  onRoutePress?: (routeNo: string) => void;
  intervalSec?: number;
  maxRows?: number;
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString('ko-KR', { hour12: false });
}

export function LiveArrivals({ query, highlight = [], onRoutePress, intervalSec = 15, maxRows = 12 }: LiveArrivalsProps) {
  const t = useTheme();
  const [rows, setRows] = useState<UnifiedArrival[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [focused, setFocused] = useState(true);
  const seq = useRef(0);
  const key = query ? `${query.region}|${query.stationId}|${query.stopNo}|${query.cityCode ?? ''}` : '';

  const load = useCallback(async () => {
    if (!query) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const list = await fetchArrivals(await getApiKey(), { ...query, routes: [] });
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
    // key 가 바뀔 때만 새 함수
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  useEffect(() => {
    setRows(null);
    setError('');
    if (!query || !focused) return;
    void load();
    const id = setInterval(() => {
      if (AppState.currentState === 'active') void load();
    }, intervalSec * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, focused, intervalSec, load]);

  if (!query) return null;

  const hl = new Set(highlight.map((h) => h.toUpperCase()));
  const sorted = [...(rows ?? [])].sort((a, b) => {
    const ah = hl.has(a.routeNo.toUpperCase()) ? 0 : 1;
    const bh = hl.has(b.routeNo.toUpperCase()) ? 0 : 1;
    return ah - bh || a.arrSec - b.arrSec;
  });

  return (
    <View style={[styles.wrap, { borderColor: t.border, backgroundColor: t.card }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.text }]}>🚌 실시간 도착 정보</Text>
        <Pressable onPress={() => void load()} hitSlop={10} accessibilityRole="button" accessibilityLabel="새로고침">
          {loading ? (
            <ActivityIndicator size="small" />
          ) : (
            <Text style={{ color: t.primary, fontWeight: '700' }}>↻ 새로고침</Text>
          )}
        </Pressable>
      </View>

      {error ? <Muted style={{ color: t.danger }}>{error}</Muted> : null}
      {rows && rows.length === 0 && !error ? <Muted>지금 도착 예정인 버스가 없습니다.</Muted> : null}
      {!rows && !error ? <Muted>불러오는 중…</Muted> : null}

      {sorted.slice(0, maxRows).map((a, i) => {
        const on = hl.has(a.routeNo.toUpperCase());
        const soon = a.arrSec <= 120;
        return (
          <Pressable
            key={`${a.routeNo}-${a.vehicleIdOrPlate}-${i}`}
            onPress={onRoutePress ? () => onRoutePress(a.routeNo) : undefined}
            style={[styles.row, { borderColor: t.border }, on && { backgroundColor: t.chip }]}
          >
            <View style={[styles.badge, { backgroundColor: on ? t.primary : t.inputBg, borderColor: t.border }]}>
              <Text style={{ color: on ? t.primaryText : t.text, fontWeight: '800' }}>{a.routeNo}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: soon ? t.danger : t.text, fontWeight: '700', fontSize: 15 }}>
                {a.prevStationCnt}정거장 전 · {formatArrSec(a.arrSec)} 후
              </Text>
              {a.extraInfo || a.vehicleIdOrPlate ? (
                <Text numberOfLines={1} style={{ color: t.sub, fontSize: 12 }}>
                  {[a.vehicleIdOrPlate && !a.extraInfo.includes(a.vehicleIdOrPlate) ? a.vehicleIdOrPlate : '', a.extraInfo]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              ) : null}
            </View>
            {onRoutePress ? <Text style={{ color: on ? t.primary : t.sub, fontSize: 18 }}>{on ? '✓' : '＋'}</Text> : null}
          </Pressable>
        );
      })}

      <Muted style={{ marginTop: 6, fontSize: 12 }}>
        {updatedAt ? `${timeLabel(updatedAt)} 기준 · ${intervalSec}초마다 자동 갱신` : ''}
        {onRoutePress ? ' · 노선을 누르면 선택/해제' : ''}
      </Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 12, marginTop: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontSize: 15, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 6, borderTopWidth: StyleSheet.hairlineWidth, borderRadius: 8 },
  badge: { minWidth: 54, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, alignItems: 'center', marginRight: 10 },
});
