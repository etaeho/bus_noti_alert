/**
 * 길 건너편 같은 이름 정류장과의 위치로 버스 진행 방향 추정 (우측통행)
 *  - 정류장은 진행 방향의 오른쪽에 있으므로, 진행 방향 = (건너편 → 이 정류장) 방위 - 90°
 */
import { distanceM } from './decide';
import type { StopCandidate } from './types';

export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const t = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * t) * Math.cos(lat2 * t);
  const x = Math.cos(lat1 * t) * Math.sin(lat2 * t) - Math.sin(lat1 * t) * Math.cos(lat2 * t) * Math.cos((lon2 - lon1) * t);
  return ((Math.atan2(y, x) / t) + 360) % 360;
}

const COMPASS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
export function compassLabel(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

function normName(s: string): string {
  return s.replace(/\s|\(.*?\)|정류장|정류소/g, '');
}

/** 같은 이름이고 150m 이내인 가장 가까운 다른 정류장 */
export function findPairStop(stop: StopCandidate, candidates: StopCandidate[]): StopCandidate | null {
  if (stop.latitude == null || stop.longitude == null) return null;
  let best: StopCandidate | null = null;
  let bestD = 150;
  for (const c of candidates) {
    if (c.latitude == null || c.longitude == null) continue;
    if ((c.stationId || c.stopNo) === (stop.stationId || stop.stopNo)) continue;
    if (normName(c.stopName) !== normName(stop.stopName)) continue;
    const d = distanceM(stop.latitude, stop.longitude, c.latitude, c.longitude);
    if (d > 3 && d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

/** 진행 방향 추정. 건너편 정류장이 없으면 null */
export function estimateTravelDirection(
  stop: StopCandidate,
  candidates: StopCandidate[],
): { bearing: number; label: string } | null {
  const pair = findPairStop(stop, candidates);
  if (!pair) return null;
  const across = bearingDeg(pair.latitude!, pair.longitude!, stop.latitude!, stop.longitude!);
  const travel = (across - 90 + 360) % 360;
  return { bearing: travel, label: `${compassLabel(travel)}쪽 방향 (위치로 추정)` };
}
