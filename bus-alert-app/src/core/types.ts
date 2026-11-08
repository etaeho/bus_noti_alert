/**
 * 앱 전역 도메인 타입.
 * 원본 bus_notifier.py 의 WatchTarget / UnifiedArrival 을 그대로 옮기고,
 * 모바일 앱용 알림 스케줄(시간대·요일·반복) 설정을 추가했다.
 */

/** 지원 권역. daejeon 등 TAGO 도시는 tago 계열로 처리된다. */
export type Region =
  | 'daejeon'
  | 'sejong'
  | 'daegu'
  | 'incheon'
  | 'gwangju'
  | 'ulsan'
  | 'seongnam'
  | 'gyeonggi'
  | 'seoul';

export const REGION_LABELS: Record<Region, string> = {
  daejeon: '대전',
  sejong: '세종',
  daegu: '대구',
  incheon: '인천',
  gwangju: '광주',
  ulsan: '울산',
  seongnam: '성남',
  gyeonggi: '경기',
  seoul: '서울',
};

/** 원본 TAGO_CITY_CODES */
export const TAGO_CITY_CODES: Partial<Record<Region, string>> = {
  daejeon: '25',
  sejong: '12',
  daegu: '22',
  incheon: '23',
  gwangju: '24',
  ulsan: '26',
};

/** 시:분 (0~23, 0~59) */
export interface TimeOfDay {
  hour: number;
  minute: number;
}

/** 0=일 1=월 ... 6=토 (JS Date.getDay 와 동일) */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** 버스 도착 알림 1건의 설정 (= 원본 WatchTarget + 배치 스케줄) */
export interface BusAlarm {
  id: string;
  /** 사용자가 붙이는 이름 (예: "출근 311번") */
  label: string;
  enabled: boolean;

  region: Region;
  /** 5자리 정류소 번호 (ARS / mobileNo / nodeNo) */
  stopNo: string;
  stopName: string;
  /** 해석된 내부 정류소 ID (TAGO nodeId / GBIS stationId). 비어 있으면 자동 조회 */
  stationId: string;
  /** TAGO 도시코드 직접 지정 (비우면 권역 기본값) */
  cityCode: string;
  /** 감시할 노선 번호. 비어 있으면 정류장의 모든 노선 */
  routes: string[];

  /** 감시 시작/종료 시각. 종료가 시작보다 이르면 자정을 넘기는 시간대로 해석 */
  windowStart: TimeOfDay;
  windowEnd: TimeOfDay;
  /** 반복 요일 */
  days: Weekday[];

  /** N정거장 전 알림 (예: [3, 2] → 3정거장 전, 2정거장 전 각 1회). 비우면 끔 */
  stopAlerts?: number[];
  /** 도착 N분 전 알림 (원본 ALERT_THRESHOLD_MIN). 0 이면 끔 */
  thresholdMin: number;
  /** 조회 간격(초) (원본 POLL_INTERVAL_SEC) */
  pollIntervalSec: number;
  /**
   * 같은 버스가 알림 기준 이내에 있는 동안 N분마다 다시 알림.
   * 0 이면 버스 1대당 1회만 알림 (원본 동작)
   */
  repeatIntervalMin: number;
  /** 감시 시작 시 현재 운행 현황 요약 알림 (원본 SEND_START_SUMMARY) */
  sendStartSummary: boolean;

  createdAt: number;
}

/** 하차(내리는 곳) 알림 설정: 내릴 정류장의 도착정보로 내 버스가 몇 정거장 전인지 추적 */
export interface RideAlert {
  active: boolean;
  region: Region;
  cityCode: string;
  stopNo: string;
  stationId: string;
  stopName: string;
  /** 타고 있는 버스 노선 */
  routeNo: string;
  /** N정거장 전 알림 (예: [3, 2, 1]) */
  stopAlerts: number[];
  /** 도착 직전 "지금 내리세요" 알림 */
  arriveAlert: boolean;
  pollIntervalSec: number;
  startedAt: number;
}

/** 원본 UnifiedArrival */
export interface UnifiedArrival {
  regionLabel: string;
  stopName: string;
  stopNo: string;
  routeNo: string;
  arrSec: number;
  prevStationCnt: string;
  vehicleType: string;
  vehicleIdOrPlate: string;
  extraInfo: string;
  /** 노선 종류 (간선·지선·광역·마을·좌석·급행·순환·공항 등) */
  routeType?: string;
}

/** 정류장 조회 결과 */
export interface StopInfo {
  stopNo: string;
  stopName: string;
  stationId: string;
  latitude?: number;
  longitude?: number;
}

/** 노선별 마지막 알림 상태 (원본 last_notified_sec_map / last_notified_plate_map) */
export interface RouteNotifyState {
  lastArrSec: number;
  lastPlate: string;
  /** 마지막으로 본 남은 정거장 수 (새 버스 판단용) */
  lastCnt?: number | null;
  /** N분 전 알림을 마지막으로 보낸 시각 */
  lastNotifiedAt: number;
  /** 이 버스에 대해 N분 전 알림을 이미 보냈는지 */
  minuteNotified?: boolean;
  /** 이 버스에 대해 이미 보낸 N정거장 전 알림 */
  notifiedStages?: number[];
}

/** 알림(alarm)별 런타임 상태 */
export interface AlarmRuntimeState {
  /** 현재 감시 회차 키 (YYYY-MM-DD 시작일) - 바뀌면 새 회차 */
  sessionKey: string;
  lastPolledAt: number;
  startSummarySent: boolean;
  routes: Record<string, RouteNotifyState>;
  /** 화면 표시용 최근 조회 결과 */
  lastArrivals: UnifiedArrival[];
  lastError: string;
}

export interface RideRuntimeState {
  lastPolledAt: number;
  /** 추적 중인 차량번호 (제공되는 지역만) */
  trackedPlate: string;
  /** 처음 추적할 때 앞에서부터 몇 대를 건너뛸지 ("다음 버스로 바꾸기") */
  skipBuses: number;
  notifiedStages: number[];
  arrivedNotified: boolean;
  lastCnt: number | null;
  lastArrSec: number | null;
  lastError: string;
}

export interface AppSettings {
  telegramEnabled: boolean;
  telegramChatId: string;
  /** 감시 시작 시각에 OS 예약 알림으로 안내 (백그라운드 실행이 중단된 경우 대비) */
  startReminderEnabled: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  telegramEnabled: false,
  telegramChatId: '',
  startReminderEnabled: true,
};

/** 정류장 검색/지도 선택 결과 */
export interface StopCandidate {
  region: Region;
  cityCode: string;
  /** 정류장 표지판 번호 (ARS / mobileNo / nodeNo). 없을 수 있음 */
  stopNo: string;
  stopName: string;
  /** 내부 정류소 ID (TAGO nodeId / GBIS stationId / 서울 stId) */
  stationId: string;
  latitude?: number;
  longitude?: number;
  distanceM?: number;
}

/** 정류장의 진행 방향 정보 */
export interface StopDirection {
  /** 예: "대전역 방면" */
  label: string;
  /** 다음 정류장 (지도에 화살표 표시용) */
  nextStopName?: string;
  nextLatitude?: number;
  nextLongitude?: number;
  /** 이 정류장을 지나는 노선 번호 */
  routes: string[];
}
