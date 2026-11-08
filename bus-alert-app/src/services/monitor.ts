/**
 * 감시 엔진: 원본 bus_notifier.py 의 배치 폴링 루프를 "틱(tick)" 단위로 쪼갠 것.
 * 위치 업데이트 태스크 / 백그라운드 태스크 / 포그라운드 타이머 어디서 호출돼도
 * 각 알림의 조회 간격(pollIntervalSec)을 지키며 한 번씩만 조회한다.
 */
import { fetchArrivals } from '../core/busApi';
import { decideAlarmNotifications, decideRide, emptyAlarmState, type OutgoingNotification } from '../core/decide';
import { formatArrivalMessage } from '../core/format';
import { getActiveWindow, isWindowActiveOrSoon } from '../core/schedule';
import type { BusAlarm } from '../core/types';
import { CHANNEL_RIDE, deliver } from './notify';
import {
  appendLog,
  getAlarms,
  getAllAlarmStates,
  getApiKey,
  getRide,
  getRideState,
  releaseLock,
  saveAllAlarmStates,
  saveRide,
  saveRideState,
  tryAcquireLock,
} from './storage';

let running: Promise<void> | null = null;

export interface TickOptions {
  source: 'location' | 'background' | 'foreground';
}

export function runMonitorTick(opts: TickOptions): Promise<void> {
  if (running) return running;
  running = (async () => {
    if (!(await tryAcquireLock(25_000))) return;
    try {
      await tickAlarms();
      await tickRide();
    } catch (e) {
      await appendLog(`[${opts.source}] 감시 오류: ${(e as Error).message}`);
    } finally {
      await releaseLock();
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

async function tickAlarms(): Promise<void> {
  const alarms = (await getAlarms()).filter((a) => a.enabled);
  if (!alarms.length) return;
  const now = new Date();
  const states = await getAllAlarmStates();
  let apiKey: string | null = null;
  let changed = false;

  for (const alarm of alarms) {
    const win = getActiveWindow(alarm, now);
    if (!win) continue;
    const prev = states[alarm.id] ?? emptyAlarmState();
    const sameSession = prev.sessionKey === win.sessionKey;
    if (sameSession && now.getTime() - prev.lastPolledAt < alarm.pollIntervalSec * 1000 - 3000) continue;

    apiKey ??= await getApiKey();
    try {
      const arrivals = await fetchArrivals(apiKey, alarm);
      const { notifications, state } = decideAlarmNotifications(
        alarm,
        arrivals,
        prev,
        win.sessionKey,
        win.end,
        now.getTime(),
      );
      states[alarm.id] = state;
      changed = true;
      for (const n of notifications) await deliver(n);
      if (notifications.length) await appendLog(`${alarm.label || alarm.stopNo}: 알림 ${notifications.length}건 전송`);
    } catch (e) {
      const msg = (e as Error).message;
      states[alarm.id] = {
        ...(sameSession ? prev : emptyAlarmState(win.sessionKey)),
        lastPolledAt: now.getTime(),
        lastError: msg,
      };
      changed = true;
      await appendLog(`${alarm.label || alarm.stopNo}: 조회 실패 - ${msg}`);
    }
  }
  if (changed) await saveAllAlarmStates(states);
}

async function tickRide(): Promise<void> {
  const ride = await getRide();
  if (!ride?.active) return;
  const prev = await getRideState();
  const now = Date.now();
  if (now - prev.lastPolledAt < (ride.pollIntervalSec || 30) * 1000 - 3000) return;
  let arrivals;
  try {
    arrivals = await fetchArrivals(await getApiKey(), {
      region: ride.region,
      stopNo: ride.stopNo,
      stationId: ride.stationId,
      cityCode: ride.cityCode,
      stopName: ride.stopName,
      routes: [ride.routeNo],
    });
  } catch (e) {
    await saveRideState({ ...prev, lastPolledAt: now, lastError: (e as Error).message });
    return;
  }
  const { notifications, state, finished } = decideRide(ride, prev, arrivals, now);
  await saveRideState(state);
  for (const n of notifications) await deliver(n, CHANNEL_RIDE);
  if (finished) {
    await saveRide({ ...ride, active: false });
    await saveRideState(state);
    await appendLog(`하차 알림 완료: ${ride.routeNo}번 → ${ride.stopName || ride.stopNo}`);
  }
}

/** "지금 1회 점검" (원본 RUN_ONCE_NOW): 시간대와 무관하게 조회해서 노선별 1건씩 알림 */
export async function runOnceNow(alarm: BusAlarm, sendNotification: boolean) {
  const apiKey = await getApiKey();
  const arrivals = await fetchArrivals(apiKey, alarm);
  if (sendNotification) {
    const seen = new Set<string>();
    const out: OutgoingNotification[] = [];
    for (const a of arrivals) {
      if (seen.has(a.routeNo)) continue;
      seen.add(a.routeNo);
      out.push({ key: `${alarm.id}:test:${a.routeNo}`, ...formatArrivalMessage(a) });
    }
    if (!out.length) {
      out.push({
        key: `${alarm.id}:test`,
        title: `ℹ️ ${alarm.label || '버스 알림'}`,
        body: `${alarm.stopName || alarm.stopNo} 정류장에 현재 도착 예정인 ${alarm.routes.join(', ') || ''}번 버스가 없습니다. (연동 정상 확인 완료)`,
      });
    }
    for (const n of out) await deliver(n);
  }
  return arrivals;
}

export function hasActiveWindowSoon(alarms: BusAlarm[], now = new Date()): boolean {
  return alarms.some((a) => a.enabled && isWindowActiveOrSoon(a, now, 10 * 60_000));
}
