import type { BusAlarm, TimeOfDay, Weekday } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

function toMinutes(t: TimeOfDay): number {
  return t.hour * 60 + t.minute;
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatTime(t: TimeOfDay): string {
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
}

export interface ActiveWindow {
  /** 감시 회차 키: 시간대가 시작된 날짜 */
  sessionKey: string;
  start: Date;
  end: Date;
}

/**
 * 주어진 시각에 알림의 감시 시간대가 열려 있으면 그 회차 정보를 반환.
 * - 종료 시각 <= 시작 시각이면 자정을 넘기는 시간대 (예: 23:00~01:00)
 * - 반복 요일은 "시간대가 시작되는 날" 기준
 * - 요일을 하나도 고르지 않으면 매일
 */
export function getActiveWindow(alarm: BusAlarm, now: Date): ActiveWindow | null {
  const startMin = toMinutes(alarm.windowStart);
  let endMin = toMinutes(alarm.windowEnd);
  if (endMin <= startMin) endMin += 24 * 60;

  // 오늘 시작한 회차와 어제 시작해서 자정을 넘긴 회차를 모두 검사
  for (const offsetDays of [0, -1]) {
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
    const day = base.getDay() as Weekday;
    if (alarm.days.length > 0 && !alarm.days.includes(day)) continue;
    const start = new Date(base.getTime() + startMin * 60_000);
    const end = new Date(base.getTime() + endMin * 60_000);
    if (now >= start && now < end) {
      return { sessionKey: dateKey(base), start, end };
    }
  }
  return null;
}

/** 지금 이후 가장 가까운 감시 시작 시각 (7일 이내). 없으면 null */
export function getNextWindowStart(alarm: BusAlarm, now: Date): Date | null {
  const startMin = toMinutes(alarm.windowStart);
  for (let i = 0; i <= 7; i++) {
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const day = base.getDay() as Weekday;
    if (alarm.days.length > 0 && !alarm.days.includes(day)) continue;
    const start = new Date(base.getTime() + startMin * 60_000);
    if (start > now) return start;
  }
  return null;
}

/** 지금부터 withinMs 안에 감시가 시작되거나 이미 진행 중인지 */
export function isWindowActiveOrSoon(alarm: BusAlarm, now: Date, withinMs: number): boolean {
  if (getActiveWindow(alarm, now)) return true;
  const next = getNextWindowStart(alarm, now);
  return next !== null && next.getTime() - now.getTime() <= withinMs;
}

export function describeDays(days: Weekday[]): string {
  if (days.length === 0 || days.length === 7) return '매일';
  const sorted = [...days].sort();
  if (sorted.join(',') === '1,2,3,4,5') return '평일';
  if (sorted.join(',') === '0,6') return '주말';
  const labels = ['일', '월', '화', '수', '목', '금', '토'];
  return sorted.map((d) => labels[d]).join('·');
}

export { DAY_MS };
