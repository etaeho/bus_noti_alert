/**
 * 정류장 방면 조회 + 기억
 *  - 실제로 판별한 방면(노선정보 또는 도착정보)은 기기에 저장해 두고,
 *    버스가 거의 없는 시간(심야 등)에 판별이 안 되면 저장된 값을 보여 준다.
 *  - 즐겨찾기/최근 본 정류장의 방면 문구도 함께 갱신한다.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { stopDirection } from '../core/busApi';
import type { StopCandidate, StopDirection, UnifiedArrival } from '../core/types';
import { getApiKey, stopKeyOf, updateSavedDirection } from './storage';

const CACHE_KEY = 'busalert:directionCache:v1';
type Cache = Record<string, StopDirection & { at: number }>;

let memo: Cache | null = null;

async function readCache(): Promise<Cache> {
  if (memo) return memo;
  try {
    memo = JSON.parse((await AsyncStorage.getItem(CACHE_KEY)) ?? '{}') as Cache;
  } catch {
    memo = {};
  }
  return memo;
}

async function saveCache(key: string, d: StopDirection): Promise<void> {
  const c = await readCache();
  c[key] = { ...d, note: undefined, at: Date.now() };
  memo = c;
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(c)).catch(() => {});
}

export async function getCachedDirection(stop: StopCandidate): Promise<StopDirection | null> {
  return (await readCache())[stopKeyOf(stop)] ?? null;
}

const inflight = new Map<string, Promise<StopDirection>>();

/**
 * @param maxAgeMs 이 시간 안에 판별한 값이 있으면 다시 조회하지 않음 (목록 화면용)
 */
export async function resolveDirection(
  stop: StopCandidate,
  neighbors?: StopCandidate[],
  maxAgeMs = 0,
): Promise<StopDirection> {
  const key = stopKeyOf(stop);
  const cached = (await readCache())[key];
  if (cached && maxAgeMs > 0 && Date.now() - cached.at < maxAgeMs) return cached;
  const running = inflight.get(key);
  if (running) return running;
  const p = doResolve(key, stop, cached, neighbors).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function doResolve(
  key: string,
  stop: StopCandidate,
  cached: (StopDirection & { at: number }) | undefined,
  neighbors?: StopCandidate[],
): Promise<StopDirection> {
  try {
    const d = await stopDirection(await getApiKey(), stop, neighbors);
    if (d.label && !d.estimated) {
      await saveCache(key, d);
      await updateSavedDirection(key, d.label).catch(() => {});
      return d;
    }
    if (cached) return { ...cached, routes: d.routes.length ? d.routes : cached.routes, note: undefined };
    return d;
  } catch (e) {
    if (cached) return cached;
    throw e;
  }
}

/**
 * 도착정보에 버스별 방면을 붙인다 (서울·경기는 API 가 직접 주고, TAGO 는 저장된 판별값 사용)
 * 네트워크를 쓰지 않으므로 백그라운드 알림에서도 가볍게 쓸 수 있다.
 */
export async function attachDirections(stop: StopCandidate, arrivals: UnifiedArrival[]): Promise<UnifiedArrival[]> {
  if (arrivals.every((a) => a.direction)) return arrivals;
  const d = await getCachedDirection(stop);
  if (!d) return arrivals;
  return arrivals.map((a) =>
    a.direction ? a : { ...a, direction: d.routeDirections?.[a.routeNo] ?? (d.label || undefined) },
  );
}
