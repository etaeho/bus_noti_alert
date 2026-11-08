/**
 * 영속 저장소. UI 와 백그라운드 태스크가 같은 데이터를 공유하므로
 * 메모리 캐시 없이 항상 AsyncStorage 를 직접 읽고 쓴다.
 * 비밀값(API 키, 텔레그램 토큰)은 SecureStore 에 보관한다.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { emptyAlarmState, emptyRideState } from '../core/decide';
import {
  DEFAULT_SETTINGS,
  type AlarmRuntimeState,
  type AppSettings,
  type BusAlarm,
  type RideAlert,
  type RideRuntimeState,
} from '../core/types';

const K = {
  alarms: 'busalert:alarms:v1',
  alarmState: 'busalert:alarmState:v1',
  ride: 'busalert:ride:v1',
  rideState: 'busalert:rideState:v1',
  settings: 'busalert:settings:v1',
  serviceMode: 'busalert:serviceMode:v1',
  lock: 'busalert:lock:v1',
  log: 'busalert:log:v1',
};

const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  // 화면 잠금 상태의 백그라운드 태스크에서도 읽을 수 있어야 함
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};
const SECRET_API_KEY = 'busalert_data_go_kr_key';
const SECRET_TELEGRAM = 'busalert_telegram_token';

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

// ── 알림 목록 ──
export async function getAlarms(): Promise<BusAlarm[]> {
  return readJson<BusAlarm[]>(K.alarms, []);
}
export async function saveAlarms(alarms: BusAlarm[]): Promise<void> {
  await writeJson(K.alarms, alarms);
}
export async function upsertAlarm(alarm: BusAlarm): Promise<void> {
  const list = await getAlarms();
  const idx = list.findIndex((a) => a.id === alarm.id);
  if (idx >= 0) list[idx] = alarm;
  else list.push(alarm);
  await saveAlarms(list);
  // 설정이 바뀌면 진행 중 회차 상태 초기화
  await setAlarmState(alarm.id, emptyAlarmState());
}
export async function deleteAlarm(id: string): Promise<void> {
  await saveAlarms((await getAlarms()).filter((a) => a.id !== id));
  const states = await getAllAlarmStates();
  delete states[id];
  await writeJson(K.alarmState, states);
}

// ── 알림 런타임 상태 ──
export async function getAllAlarmStates(): Promise<Record<string, AlarmRuntimeState>> {
  return readJson<Record<string, AlarmRuntimeState>>(K.alarmState, {});
}
export async function setAlarmState(id: string, state: AlarmRuntimeState): Promise<void> {
  const all = await getAllAlarmStates();
  all[id] = state;
  await writeJson(K.alarmState, all);
}
export async function saveAllAlarmStates(states: Record<string, AlarmRuntimeState>): Promise<void> {
  await writeJson(K.alarmState, states);
}

// ── 하차 알림 ──
export async function getRide(): Promise<RideAlert | null> {
  const r = await readJson<RideAlert | null>(K.ride, null);
  // 이전 버전(GPS 거리 방식) 데이터는 무시
  if (!r || !Array.isArray(r.stopAlerts) || typeof r.routeNo !== 'string') return null;
  return r;
}
export async function saveRide(ride: RideAlert | null): Promise<void> {
  if (ride) await writeJson(K.ride, ride);
  else await AsyncStorage.removeItem(K.ride);
  await writeJson(K.rideState, emptyRideState());
}
export async function getRideState(): Promise<RideRuntimeState> {
  return { ...emptyRideState(), ...(await readJson<Partial<RideRuntimeState>>(K.rideState, {})) };
}
export async function saveRideState(s: RideRuntimeState): Promise<void> {
  await writeJson(K.rideState, s);
}

// ── 설정 ──
export async function getSettings(): Promise<AppSettings> {
  return { ...DEFAULT_SETTINGS, ...(await readJson<Partial<AppSettings>>(K.settings, {})) };
}
export async function saveSettings(s: AppSettings): Promise<void> {
  await writeJson(K.settings, s);
}

export async function getApiKey(): Promise<string> {
  try {
    return (await SecureStore.getItemAsync(SECRET_API_KEY, SECURE_OPTS)) ?? '';
  } catch {
    return '';
  }
}
export async function setApiKey(v: string): Promise<void> {
  if (v.trim()) await SecureStore.setItemAsync(SECRET_API_KEY, v.trim(), SECURE_OPTS);
  else await SecureStore.deleteItemAsync(SECRET_API_KEY, SECURE_OPTS);
}
export async function getTelegramToken(): Promise<string> {
  try {
    return (await SecureStore.getItemAsync(SECRET_TELEGRAM, SECURE_OPTS)) ?? '';
  } catch {
    return '';
  }
}
export async function setTelegramToken(v: string): Promise<void> {
  if (v.trim()) await SecureStore.setItemAsync(SECRET_TELEGRAM, v.trim(), SECURE_OPTS);
  else await SecureStore.deleteItemAsync(SECRET_TELEGRAM, SECURE_OPTS);
}

// ── 감시 서비스 모드 ──
export async function getServiceMode(): Promise<string> {
  return (await AsyncStorage.getItem(K.serviceMode)) ?? 'off';
}
export async function setServiceMode(mode: string): Promise<void> {
  await AsyncStorage.setItem(K.serviceMode, mode);
}

// ── 중복 실행 방지 락 (위치 태스크 / 백그라운드 태스크 / 포그라운드 타이머가 동시에 돌 수 있음) ──
export async function tryAcquireLock(ttlMs: number): Promise<boolean> {
  const now = Date.now();
  const until = Number((await AsyncStorage.getItem(K.lock)) ?? 0);
  if (until > now) return false;
  await AsyncStorage.setItem(K.lock, String(now + ttlMs));
  return true;
}
export async function releaseLock(): Promise<void> {
  await AsyncStorage.removeItem(K.lock);
}

// ── 활동 로그 (설정 화면에서 확인) ──
export interface LogEntry {
  at: number;
  msg: string;
}
export async function appendLog(msg: string): Promise<void> {
  const list = await readJson<LogEntry[]>(K.log, []);
  list.unshift({ at: Date.now(), msg });
  await writeJson(K.log, list.slice(0, 80));
}
export async function getLogs(): Promise<LogEntry[]> {
  return readJson<LogEntry[]>(K.log, []);
}
export async function clearLogs(): Promise<void> {
  await AsyncStorage.removeItem(K.log);
}

// ── 알림 기록 (최근 알림 화면) ──
export type HistoryKind = 'arrival' | 'stage' | 'ride' | 'start' | 'test';
export interface HistoryEntry {
  id: string;
  at: number;
  kind: HistoryKind;
  title: string;
  body: string;
}
const HISTORY_KEY = 'busalert:history:v1';
const HISTORY_SEEN_KEY = 'busalert:historySeen:v1';

export async function appendHistory(e: Omit<HistoryEntry, 'id' | 'at'>): Promise<void> {
  const list = await readJson<HistoryEntry[]>(HISTORY_KEY, []);
  const at = Date.now();
  list.unshift({ ...e, at, id: `${at.toString(36)}${Math.random().toString(36).slice(2, 6)}` });
  await writeJson(HISTORY_KEY, list.slice(0, 300));
}
export async function getHistory(): Promise<HistoryEntry[]> {
  return readJson<HistoryEntry[]>(HISTORY_KEY, []);
}
export async function clearHistory(): Promise<void> {
  await AsyncStorage.removeItem(HISTORY_KEY);
}
export async function getHistorySeenAt(): Promise<number> {
  return Number((await AsyncStorage.getItem(HISTORY_SEEN_KEY)) ?? 0);
}
export async function markHistorySeen(): Promise<void> {
  await AsyncStorage.setItem(HISTORY_SEEN_KEY, String(Date.now()));
}
