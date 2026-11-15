import { router } from 'expo-router';

import type { Region, StopCandidate } from '../core/types';

/** 정류장 상세 화면 열기 */
export function openStopDetail(stop: StopCandidate, directionLabel = '', replace = false): void {
  const params = {
    region: stop.region,
    stopNo: stop.stopNo,
    stationId: stop.stationId,
    cityCode: stop.cityCode,
    stopName: stop.stopName,
    lat: stop.latitude != null ? String(stop.latitude) : '',
    lng: stop.longitude != null ? String(stop.longitude) : '',
    dir: directionLabel,
  };
  if (replace) router.replace({ pathname: '/stop/view', params });
  else router.push({ pathname: '/stop/view', params });
}

export function stopFromParams(p: Record<string, string | string[] | undefined>): { stop: StopCandidate; dir: string } {
  const one = (k: string) => {
    const v = p[k];
    return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
  };
  const lat = Number(one('lat'));
  const lng = Number(one('lng'));
  return {
    stop: {
      region: (one('region') || 'daejeon') as Region,
      stopNo: one('stopNo'),
      stationId: one('stationId'),
      cityCode: one('cityCode'),
      stopName: one('stopName'),
      latitude: Number.isFinite(lat) && lat !== 0 ? lat : undefined,
      longitude: Number.isFinite(lng) && lng !== 0 ? lng : undefined,
    },
    dir: one('dir'),
  };
}
