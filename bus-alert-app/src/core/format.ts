import { formatTime } from './schedule';
import type { BusAlarm, RideAlert, UnifiedArrival } from './types';

export function formatArrSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}초`;
  return s === 0 ? `${m}분` : `${m}분 ${s}초`;
}

/** 원본 generate_gemini_briefing() 메시지 포맷 */
export function formatArrivalMessage(arr: UnifiedArrival, isRepeat = false): { title: string; body: string } {
  const info: string[] = [];
  if (arr.extraInfo) info.push(arr.extraInfo);
  if (arr.vehicleIdOrPlate && !arr.extraInfo.includes('차량번호')) info.push(`차량번호: ${arr.vehicleIdOrPlate}`);

  const lines = [
    `⏳ 남은시간 : ${formatArrSec(arr.arrSec)} 후`,
    `🚏 남은위치 : ${arr.prevStationCnt}정거장 전`,
    `📍 정류소명 : ${arr.stopName}`,
  ];
  if (info.length) lines.push(`💡 부가정보 : ${info.join(' | ')}`);

  return {
    title: `🚌 [${arr.routeNo}번 버스 도착 안내]${isRepeat ? ' (반복)' : ''}`,
    body: lines.join('\n'),
  };
}

/** 알림 기준 설명: "3·2정거장 전 / 5분 전" */
export function describeAlertRule(alarm: Pick<BusAlarm, 'stopAlerts' | 'thresholdMin'>): string {
  const parts: string[] = [];
  const stages = [...(alarm.stopAlerts ?? [])].sort((a, b) => b - a);
  if (stages.length) parts.push(`${stages.join('·')}정거장 전`);
  if (alarm.thresholdMin > 0) parts.push(`${alarm.thresholdMin}분 전`);
  return parts.join(' / ') || '알림 기준 없음';
}

/** N정거장 전 알림 */
export function formatStageMessage(arr: UnifiedArrival, cnt: number): { title: string; body: string } {
  const lines = [
    `⏳ 약 ${formatArrSec(arr.arrSec)} 후 도착`,
    `📍 ${arr.stopName}`,
  ];
  if (arr.vehicleIdOrPlate) lines.push(`🚌 차량번호: ${arr.vehicleIdOrPlate}`);
  return {
    title: cnt <= 0 ? `🚌 ${arr.routeNo}번 곧 도착!` : `🚌 ${arr.routeNo}번 ${cnt}정거장 전`,
    body: lines.join('\n'),
  };
}

/** 하차 알림 */
export function formatRideMessage(ride: RideAlert, arr: UnifiedArrival, cnt: number): { title: string; body: string } {
  const name = ride.stopName || ride.stopNo;
  if (cnt <= 0) {
    return { title: '🚏 지금 내리세요!', body: `${name} 정류장에 곧 도착합니다. (${ride.routeNo}번)` };
  }
  return {
    title: `🔔 내릴 정류장까지 ${cnt}정거장`,
    body: `${name} · 약 ${formatArrSec(arr.arrSec)} 후 도착 (${ride.routeNo}번). 하차 준비하세요!`,
  };
}

export function formatStartSummary(
  alarm: BusAlarm,
  nearest: UnifiedArrival[],
  noBuses: boolean,
  windowEnd: Date,
): { title: string; body: string } {
  const routesLabel = alarm.routes.length ? `${alarm.routes.join(', ')}번` : '전체 노선';
  const until = formatTime({ hour: windowEnd.getHours(), minute: windowEnd.getMinutes() });
  const lines = [
    `${alarm.stopName || alarm.stopNo} (${routesLabel}) ~${until}까지 ${describeAlertRule(alarm)}에 알려드립니다.`,
  ];
  if (noBuses) {
    lines.push('현재 도착 예정인 버스가 없습니다.');
  } else {
    for (const a of nearest) {
      lines.push(`• ${a.routeNo}번: 약 ${Math.floor(a.arrSec / 60)}분 후 (${a.prevStationCnt}정거장 전)`);
    }
  }
  return { title: `🕖 [${alarm.label || '버스 알림'}] 감시 시작`, body: lines.join('\n') };
}

/** 텔레그램 등 단일 텍스트 채널용 */
export function toPlainText(n: { title: string; body: string }): string {
  return `${n.title}\n━━━━━━━━━━━━━━━━━━\n${n.body}`;
}
