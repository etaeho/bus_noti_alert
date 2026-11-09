/**
 * 정류장 방면 조회 + 기억
 *  - 실제로 판별한 방면(노선정보 또는 도착정보)은 기기에 저장해 두고,
 *    버스가 거의 없는 시간(심야 등)에 판별이 안 되면 저장된 값을 보여 준다.
 *  - 즐겨찾기/최근 본 정류장의 방면 문구도 함께 갱신한다.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { stopDirection } from '../core/busApi';
import type { StopCandidate, StopDirection } from '../core/types';
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

export async function resolveDirection(stop: StopCandidate, neighbors?: StopCandidate[]): Promise<StopDirection> {
  const key = stopKeyOf(stop);
  const cached = (await readCache())[key];
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
