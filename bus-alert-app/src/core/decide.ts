/**
 * 알림 판단 로직 (네트워크/OS 의존성 없는 순수 함수).
 * 원본 bus_notifier.py main() 의 폴링 루프 판단부를 옮기고 "반복 알림"을 추가했다.
 */
import { formatArrivalMessage, formatStartSummary } from './format';
import type { AlarmRuntimeState, BusAlarm, RideAlert, RideRuntimeState, UnifiedArrival } from './types';

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

/** 노선별로 가장 먼저 도착하는 버스만 남김 (원본 nearest_by_route) */
export function nearestByRoute(arrivals: UnifiedArrival[]): Map<string, UnifiedArrival> {
  const sorted = [...arrivals].sort((a, b) => a.arrSec - b.arrSec);
  const map = new Map<string, UnifiedArrival>();
  for (const a of sorted) if (!map.has(a.routeNo)) map.set(a.routeNo, a);
  return map;
}

/** 원본: 차량번호가 있으면 번호 비교, 없으면 남은 시간이 120초 이상 늘어났을 때 새 버스로 판단 */
export function isNewBus(arr: UnifiedArrival, prev: { lastArrSec: number; lastPlate: string } | undefined): boolean {
  if (!prev) return true;
  if (arr.vehicleIdOrPlate && prev.lastPlate) return arr.vehicleIdOrPlate !== prev.lastPlate;
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
  const thresholdSec = alarm.thresholdMin * 60;
  const nearest = nearestByRoute(arrivals);
  const isFirstPoll = !state.startSummarySent;

  if (isFirstPoll && alarm.sendStartSummary) {
    const outside = [...nearest.values()].filter((a) => a.arrSec > thresholdSec);
    out.push({
      key: `${alarm.id}:start`,
      ...formatStartSummary(alarm, outside, nearest.size === 0, windowEnd),
    });
  }
  state.startSummarySent = true;

  for (const [routeNo, arr] of nearest) {
    if (arr.arrSec > thresholdSec) continue;
    const prev = state.routes[routeNo];
    const newBus = isNewBus(arr, prev);
    const repeatDue =
      !newBus &&
      alarm.repeatIntervalMin > 0 &&
      prev !== undefined &&
      now - prev.lastNotifiedAt >= alarm.repeatIntervalMin * 60_000;

    let lastNotifiedAt = prev?.lastNotifiedAt ?? 0;
    if (newBus || repeatDue) {
      out.push({
        key: `${alarm.id}:${routeNo}`,
        ...formatArrivalMessage(arr, repeatDue),
      });
      lastNotifiedAt = now;
    }
    state.routes[routeNo] = {
      lastArrSec: arr.arrSec,
      lastPlate: arr.vehicleIdOrPlate || prev?.lastPlate || '',
      lastNotifiedAt,
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
  return { preAlertSent: false, arrivedNotifyCount: 0, lastArrivedNotifyAt: 0, lastDistanceM: null, lastLocationAt: 0 };
}

export interface RideDecision {
  notifications: OutgoingNotification[];
  state: RideRuntimeState;
  /** 반복 알림까지 모두 보냈으면 하차 알림 종료 */
  finished: boolean;
}

/** 하차 정류장까지의 거리로 예고/도착 알림 판단 */
export function decideRide(
  ride: RideAlert,
  prev: RideRuntimeState,
  location: { latitude: number; longitude: number } | null,
  now: number,
  forceArrived = false,
): RideDecision {
  const state = { ...prev };
  const out: OutgoingNotification[] = [];
  let dist: number | null = null;
  if (location) {
    dist = Math.round(distanceM(location.latitude, location.longitude, ride.latitude, ride.longitude));
    state.lastDistanceM = dist;
    state.lastLocationAt = now;
  }
  const name = ride.stopName || ride.stopNo;
  const arrived = forceArrived || (dist !== null && dist <= ride.radiusM);

  if (!arrived && dist !== null && ride.preAlertM > ride.radiusM && dist <= ride.preAlertM && !state.preAlertSent) {
    state.preAlertSent = true;
    out.push({
      key: 'ride:pre',
      title: '🔔 곧 내릴 정류장입니다',
      body: `${name} 정류장까지 약 ${dist}m 남았습니다. 하차 준비하세요!`,
    });
  }

  if (arrived || state.arrivedNotifyCount > 0) {
    const due =
      state.arrivedNotifyCount === 0 ||
      (state.arrivedNotifyCount < ride.repeatCount && now - state.lastArrivedNotifyAt >= ride.repeatIntervalSec * 1000);
    if (due) {
      state.arrivedNotifyCount += 1;
      state.lastArrivedNotifyAt = now;
      state.preAlertSent = true;
      out.push({
        key: 'ride:arrived',
        title: '🚏 지금 내리세요!',
        body:
          `${name} 정류장에 도착했습니다` +
          (dist !== null ? ` (약 ${dist}m)` : '') +
          (ride.repeatCount > 1 ? ` [${state.arrivedNotifyCount}/${ride.repeatCount}]` : ''),
      });
    }
  }

  const finished = state.arrivedNotifyCount >= Math.max(1, ride.repeatCount);
  return { notifications: out, state, finished };
}
