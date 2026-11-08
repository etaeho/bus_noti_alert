/**
 * 정류장 선택 화면 ↔ 호출 화면 간 결과 전달 (같은 JS 런타임 안의 메모리 저장)
 * 호출 화면은 router.push('/stop-picker?purpose=alarm') 후, 화면에 돌아왔을 때 takePickedStop('alarm') 으로 받는다.
 */
import type { StopCandidate, StopDirection } from '../core/types';

export interface PickedStop {
  stop: StopCandidate;
  direction: StopDirection | null;
}

const picked = new Map<string, PickedStop>();

export function setPickedStop(purpose: string, value: PickedStop): void {
  picked.set(purpose, value);
}

export function takePickedStop(purpose: string): PickedStop | null {
  const v = picked.get(purpose) ?? null;
  picked.delete(purpose);
  return v;
}

/** 정류장 표시 이름: "명석고등학교 (대전역 방면)" */
export function displayStopName(p: PickedStop): string {
  const dir = p.direction?.label;
  return dir ? `${p.stop.stopName} (${dir})` : p.stop.stopName;
}
