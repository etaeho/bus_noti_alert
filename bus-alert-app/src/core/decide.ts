/**
 * 알림 판단 로직 (네트워크/OS 의존성 없는 순수 함수).
 * 원본 bus_notifier.py main() 의 폴링 루프 판단부를 옮기고
 * "N정거장 전 알림", "반복 알림", "하차 알림(도착정보 기반)"을 추가했다.
 */
import { formatArrivalMessage, formatRideMessage, formatStageMessage, formatStartSummary } from './format';
import type {
  AlarmRuntimeState,
  BusAlarm,
  RideAlert,
  RideRuntimeState,
  RouteNotifyState,
  UnifiedArrival,
} from './types';

export interface OutgoingNotification {
  title: string;
  body: string;
  /** 같은 키의 알림은 OS 알림센터에서 교체된다 */
  key: string;
}

export function emptyAlarmState(sessionKey = ''): AlarmRuntimeState {
  return {
    sessionKey,
    lastPolledAt: 0,
    startSummarySent: false,
    routes: {},
    lastArrivals: [],
    lastError: '',
  };
}

/** "2", "0 (곧도착)", "?" → 2, 0, null */
export function parseStopCount(raw: string): number | null {
  const m = String(raw ?? '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** 노선별로 가장 먼저 도착하는 버스만 남김 (원본 nearest_by_route) */
export function nearestByRoute(arrivals: UnifiedArrival[]): Map<string, UnifiedArrival> {
  const sorted = [...arrivals].sort((a, b) => a.arrSec - b.arrSec);
  const map = new Map<string, UnifiedArrival>();
  for (const a of sorted) if (!map.has(a.routeNo)) map.set(a.routeNo, a);
  return map;
}

/**
 * 원본: 차량번호가 있으면 번호 비교, 없으면 남은 시간이 120초 이상 늘어났을 때 새 버스로 판단.
 * 추가: 남은 정거장 수가 2 이상 늘어나도 새 버스.
 */
export function isNewBus(arr: UnifiedArrival, prev: RouteNotifyState | undefined): boolean {
  if (!prev) return true;
  if (arr.vehicleIdOrPlate && prev.lastPlate) return arr.vehicleIdOrPlate !== prev.lastPlate;
  const cnt = parseStopCount(arr.prevStationCnt);
  if (cnt !== null && prev.lastCnt !== undefined && prev.lastCnt !== null && cnt >= prev.lastCnt + 2) return true;
  return arr.arrSec > prev.lastArrSec + 120;
}

export interface DecideResult {
  notifications: OutgoingNotification[];
  state: AlarmRuntimeState;
}

export function decideAlarmNotifications(
  alarm: BusAlarm,
  arrivals: UnifiedArrival[],
  prevState: AlarmRuntimeState,
  sessionKey: string,
  windowEnd: Date,
  now: number,
): DecideResult {
  const state: AlarmRuntimeState =
    prevState.sessionKey === sessionKey
      ? { ...prevState, routes: { ...prevState.routes } }
      : emptyAlarmState(sessionKey);
  state.lastPolledAt = now;
  state.lastArrivals = arrivals;
  state.lastError = '';

  const out: OutgoingNotification[] = [];
  const stages = [...(alarm.stopAlerts ?? [])].sort((a, b) => b - a);
  const thresholdSec = alarm.thresholdMin * 60;
  const nearest = nearestByRoute(arrivals);

  if (!state.startSummarySent && alarm.sendStartSummary) {
    out.push({
      key: `${alarm.id}:start`,
      ...formatStartSummary(alarm, [...nearest.values()], nearest.size === 0, windowEnd),
    });
  }
  state.startSummarySent = true;

  for (const [routeNo, arr] of nearest) {
    const prev = state.routes[routeNo];
    const newBus = isNewBus(arr, prev);
    const cnt = parseStopCount(arr.prevStationCnt);
    const notifiedStages = newBus ? [] : [...(prev?.notifiedStages ?? [])];
    let lastNotifiedAt = newBus ? 0 : (prev?.lastNotifiedAt ?? 0);
    // 이전 버전 상태(minuteNotified 없음)는 lastNotifiedAt > 0 으로 판단
    let minuteNotified = newBus ? false : (prev?.minuteNotified ?? (prev?.lastNotifiedAt ?? 0) > 0);

    // 1) N정거장 전 알림: 3→2→… 각 단계 1회. 한 번에 여러 단계를 건너뛰면 현재 위치로 1회만 알림
    const due = cnt === null ? [] : stages.filter((s) => cnt <= s && !notifiedStages.includes(s));
    if (due.length) {
      out.push({ key: `${alarm.id}:${routeNo}`, ...formatStageMessage(arr, cnt!) });
      notifiedStages.push(...due);
    }

    // 2) 도착 N분 전 알림 (+ 반복)
    if (thresholdSec > 0 && arr.arrSec <= thresholdSec) {
      const first = !minuteNotified;
      const repeatDue =
        !first && alarm.repeatIntervalMin > 0 && now - lastNotifiedAt >= alarm.repeatIntervalMin * 60_000;
      if ((first && !due.length) || repeatDue) {
        out.push({ key: `${alarm.id}:${routeNo}`, ...formatArrivalMessage(arr, repeatDue) });
      }
      // 같은 순간 정거장 알림을 이미 보냈으면 중복 없이 기록만
      if (first || repeatDue) lastNotifiedAt = now;
      minuteNotified = true;
    }

    state.routes[routeNo] = {
      lastArrSec: arr.arrSec,
      lastPlate: arr.vehicleIdOrPlate || (newBus ? '' : prev?.lastPlate || ''),
      lastCnt: cnt,
      lastNotifiedAt,
      minuteNotified,
      notifiedStages,
    };
  }

  return { notifications: out, state };
}

/** 두 좌표 사이 거리(m) - haversine */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function emptyRideState(): RideRuntimeState {
  return {
    lastPolledAt: 0,
    trackedPlate: '',
    skipBuses: 0,
    notifiedStages: [],
    arrivedNotified: false,
    lastCnt: null,
    lastArrSec: null,
    lastError: '',
  };
}

export interface RideDecision {
  notifications: OutgoingNotification[];
  state: RideRuntimeState;
  /** 도착 알림을 보냈거나 버스가 지나가서 하차 알림 종료 */
  finished: boolean;
}

/**
 * 하차 알림: 내릴 정류장의 도착정보에서 내가 탄 노선의 버스를 추적한다.
 *  - 차량번호가 제공되면 처음 잡힌 버스의 번호로 고정 추적
 *  - N정거장 전마다 알림, 곧 도착(0정거장 또는 1분 이내)이면 "지금 내리세요"
 *  - 추적하던 버스가 목록에서 사라지거나(지나감) 남은 정거장이 크게 늘면(다음 버스) 종료
 */
export function decideRide(
  ride: RideAlert,
  prev: RideRuntimeState,
  arrivals: UnifiedArrival[],
  now: number,
): RideDecision {
  const state: RideRuntimeState = { ...prev, notifiedStages: [...prev.notifiedStages], lastPolledAt: now, lastError: '' };
  const out: OutgoingNotification[] = [];
  const mine = arrivals
    .filter((a) => a.routeNo.toUpperCase() === ride.routeNo.toUpperCase())
    .sort((a, b) => a.arrSec - b.arrSec);

  const cntOf = (a: UnifiedArrival) => parseStopCount(a.prevStationCnt);
  let bus: UnifiedArrival | undefined;
  if (state.trackedPlate) {
    bus = mine.find((a) => a.vehicleIdOrPlate === state.trackedPlate);
  } else if (state.lastCnt !== null) {
    // 차량번호가 없으면 직전 위치와 이어지는 버스(남은 정거장이 같거나 줄어든 버스)를 계속 추적
    const last = state.lastCnt;
    bus = mine
      .filter((a) => {
        const c = cntOf(a);
        return c !== null && c <= last + 1;
      })
      .sort((a, b) => Math.abs(cntOf(a)! - last) - Math.abs(cntOf(b)! - last))[0];
  } else {
    bus = mine[state.skipBuses ?? 0];
  }

  if (!bus) {
    // 추적하던 버스가 사라짐 = 정류장을 지나감 (가까이 왔던 경우)
    const wasClose = state.lastCnt !== null && state.lastCnt <= 1;
    if ((state.trackedPlate && state.lastCnt !== null) || wasClose) {
      return { notifications: finishMessage(ride, state, out), state, finished: true };
    }
    return { notifications: out, state, finished: false };
  }

  const cnt = cntOf(bus);
  if (!state.trackedPlate && bus.vehicleIdOrPlate) state.trackedPlate = bus.vehicleIdOrPlate;

  const stages = [...ride.stopAlerts].sort((a, b) => b - a);
  const due = cnt === null ? [] : stages.filter((s) => cnt <= s && s > 0 && !state.notifiedStages.includes(s));
  const arriving = (cnt !== null && cnt === 0) || bus.arrSec <= 60;

  if (arriving && ride.arriveAlert && !state.arrivedNotified) {
    state.arrivedNotified = true;
    out.push({ key: 'ride', ...formatRideMessage(ride, bus, 0) });
  } else if (due.length && cnt !== null) {
    out.push({ key: 'ride', ...formatRideMessage(ride, bus, cnt) });
  }
  state.notifiedStages.push(...due);
  state.lastCnt = cnt;
  state.lastArrSec = bus.arrSec;

  const allStagesDone = stages.every((s) => state.notifiedStages.includes(s));
  const finished = ride.arriveAlert ? state.arrivedNotified : allStagesDone && arriving;
  return { notifications: out, state, finished };
}

function finishMessage(ride: RideAlert, state: RideRuntimeState, out: OutgoingNotification[]): OutgoingNotification[] {
  if (ride.arriveAlert && !state.arrivedNotified) {
    state.arrivedNotified = true;
    out.push({
      key: 'ride',
      title: '🚏 내릴 정류장입니다',
      body: `${ride.routeNo}번 버스가 ${ride.stopName || ride.stopNo} 정류장에 도착했거나 지나갔습니다.`,
    });
  }
  return out;
}
