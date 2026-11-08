/**
 * 현재 위치 주변 정류장 (가까운 순) + 방면
 */
import * as Location from 'expo-location';
import { useCallback, useRef, useState } from 'react';

import { nearbyStops, regionFromAddress, stopDirection } from '../core/busApi';
import { distanceM } from '../core/decide';
import type { Region, StopCandidate, StopDirection } from '../core/types';
import { getApiKey, stopKeyOf } from './storage';

export type DirState = StopDirection | 'loading' | 'error';

export function useNearbyStops(limit = 6) {
  const [stops, setStops] = useState<StopCandidate[]>([]);
  const [directions, setDirections] = useState<Record<string, DirState>>({});
  const [me, setMe] = useState<{ latitude: number; longitude: number } | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [needsPermission, setNeedsPermission] = useState(false);
  const busy = useRef(false);

  const load = useCallback(
    async (ask = false) => {
      if (busy.current) return;
      busy.current = true;
      setLoading(true);
      setError('');
      try {
        const key = await getApiKey();
        if (!key) {
          setError('설정에서 API 키를 입력하면 주변 정류장을 볼 수 있습니다.');
          return;
        }
        const perm = ask ? await Location.requestForegroundPermissionsAsync() : await Location.getForegroundPermissionsAsync();
        if (!perm.granted) {
          setNeedsPermission(true);
          return;
        }
        setNeedsPermission(false);
        const pos =
          (await Location.getLastKnownPositionAsync({ maxAge: 2 * 60_000 })) ??
          (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        const here = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setMe(here);
        let rg: Region = 'daejeon';
        try {
          const [addr] = await Location.reverseGeocodeAsync(here);
          rg = (addr && regionFromAddress([addr.region, addr.city, addr.subregion, addr.district])) || rg;
        } catch {
          // 기본 권역
        }
        setRegion(rg);
        const all = (await nearbyStops(key, rg, here.latitude, here.longitude)).map((s) => ({
          ...s,
          distanceM:
            s.distanceM ??
            (s.latitude && s.longitude ? distanceM(here.latitude, here.longitude, s.latitude, s.longitude) : undefined),
        }));
        all.sort((a, b) => (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9));
        const top = all.slice(0, limit);
        setStops(top);
        // 방면은 하나씩 (주변 목록을 함께 넘겨 위치 추정에도 사용)
        for (const s of top) {
          const k = stopKeyOf(s);
          setDirections((d) => ({ ...d, [k]: d[k] && d[k] !== 'error' ? d[k] : 'loading' }));
          stopDirection(key, s, all)
            .then((dir) => setDirections((d) => ({ ...d, [k]: dir })))
            .catch(() => setDirections((d) => ({ ...d, [k]: 'error' })));
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        busy.current = false;
        setLoading(false);
      }
    },
    [limit],
  );

  return { stops, directions, me, region, loading, error, needsPermission, load };
}
