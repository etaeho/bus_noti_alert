/**
 * 전국 버스 도착정보 조회 (원본 bus_notifier.py 의 fetch_* 함수들을 TypeScript 로 이식)
 *  - 대전/세종/대구/인천/광주/울산: 국토교통부 TAGO
 *  - 성남/경기: 경기도 GBIS v2 (성남은 실패 시 TAGO 31020 으로 폴백)
 *  - 서울: 서울시 버스정보 (ws.bus.go.kr)
 */
import { XMLParser } from 'fast-xml-parser';

import {
  TAGO_CITY_CODES,
  type Region,
  type StopCandidate,
  type StopDirection,
  type StopInfo,
  type UnifiedArrival,
} from './types';

const TAGO_STOP_SEARCH_URL = 'http://apis.data.go.kr/1613000/BusSttnInfoInqireService/getSttnNoList';
const TAGO_ARRIVAL_ALL_URL = 'http://apis.data.go.kr/1613000/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList';
const GBIS_STATION_LIST_URL = 'https://apis.data.go.kr/6410000/busstationservice/v2/getBusStationListv2';
const GBIS_ARRIVAL_LIST_URL = 'https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalListv2';
const SEOUL_STATION_UID_URL = 'http://ws.bus.go.kr/api/rest/stationinfo/getStationByUid';

type Item = Record<string, unknown>;

/** 원본 fetch_* 가 받는 타겟 정보 */
export interface ArrivalQuery {
  region: Region;
  stopNo: string;
  stationId?: string;
  cityCode?: string;
  stopName?: string;
  routes: string[];
}

export class BusApiError extends Error {}

const xml = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });

/** Encoding/Decoding 인증키 모두 허용 (원본: urllib.parse.unquote) */
export function normalizeServiceKey(raw: string): string {
  const k = raw.trim();
  if (!k) return '';
  try {
    return k.includes('%') ? decodeURIComponent(k) : k;
  } catch {
    return k;
  }
}

function buildUrl(base: string, params: Record<string, string | number>): string {
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `${base}?${qs}`;
}

async function httpGet(url: string, timeoutMs = 10_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    const text = await resp.text();
    if (!resp.ok) throw new BusApiError(`HTTP ${resp.status}: ${text.slice(0, 120)}`);
    return text;
  } catch (e) {
    if (e instanceof BusApiError) throw e;
    if ((e as Error)?.name === 'AbortError') throw new BusApiError('요청 시간 초과');
    throw new BusApiError(`네트워크 오류: ${(e as Error)?.message ?? e}`);
  } finally {
    clearTimeout(timer);
  }
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null || (v as unknown) === '') return [];
  return Array.isArray(v) ? v : [v];
}

function str(v: unknown, fallback = ''): string {
  if (v === undefined || v === null) return fallback;
  const s = String(v).trim();
  return s === '' ? fallback : s;
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : undefined;
}

function findDeep(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  const rec = obj as Record<string, unknown>;
  if (key in rec) return rec[key];
  for (const v of Object.values(rec)) {
    const found = findDeep(v, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** 원본 parse_tago_response: JSON 또는 XML(인증 오류 시 XML 로 옴) */
export function parseTagoResponse(text: string): Item[] {
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith('{')) {
    const data = JSON.parse(t);
    const header = data?.response?.header;
    if (header?.resultCode && !['00', '0', '0000'].includes(String(header.resultCode))) {
      throw new BusApiError(`API 오류: ${header.resultMsg ?? header.resultCode}`);
    }
    const items = data?.response?.body?.items;
    if (!items) return [];
    return asArray(items.item as Item | Item[]);
  }
  const root = xml.parse(t);
  const errMsg = str(findDeep(root, 'returnAuthMsg')) || str(findDeep(root, 'errMsg'));
  const resultMsg = str(findDeep(root, 'resultMsg'));
  if (errMsg && errMsg !== 'NORMAL_CODE' && errMsg !== 'NORMAL SERVICE.') {
    throw new BusApiError(`공공데이터포털 API 인증/호출 오류: ${errMsg} (${resultMsg})`);
  }
  const items = findDeep(root, 'items') as Record<string, unknown> | undefined;
  return items && typeof items === 'object' ? asArray(items.item as Item | Item[]) : [];
}

function tagoCityCode(q: ArrivalQuery, override?: string): string {
  return override || q.cityCode || TAGO_CITY_CODES[q.region] || '25';
}

// ───────────────────────────── TAGO ─────────────────────────────

async function lookupTagoStop(key: string, cityCode: string, stopNo: string): Promise<StopInfo | null> {
  const url = buildUrl(TAGO_STOP_SEARCH_URL, {
    serviceKey: key,
    cityCode,
    nodeNo: stopNo,
    numOfRows: 30,
    pageNo: 1,
    _type: 'json',
  });
  const items = parseTagoResponse(await httpGet(url));
  for (const it of items) {
    if (str(it.nodeno) === stopNo) {
      return {
        stopNo,
        stopName: str(it.nodenm, stopNo),
        stationId: str(it.nodeid),
        latitude: num(it.gpslati),
        longitude: num(it.gpslong),
      };
    }
  }
  return null;
}

/** 원본 resolve_tago_node_id (대전 명석고 하드코딩 폴백 포함) */
async function resolveTagoNodeId(key: string, cityCode: string, q: ArrivalQuery): Promise<string> {
  if (q.stationId) return q.stationId;
  try {
    const info = await lookupTagoStop(key, cityCode, q.stopNo);
    if (info?.stationId) return info.stationId;
  } catch {
    // 정류소정보 API 미신청 등 - 아래 폴백
  }
  if (cityCode === '25' && q.stopNo === '51630') return 'DJB8001611';
  if (cityCode === '25' && q.stopNo === '11690') return 'DJB8001610';
  throw new BusApiError(
    `[TAGO] 도시코드 ${cityCode}에서 정류소 번호 ${q.stopNo}의 nodeId를 찾지 못했습니다. ` +
      "공공데이터포털 '국토교통부_(TAGO)_버스정류소정보' 활용신청 여부를 확인해 주세요.",
  );
}

async function fetchTagoArrivals(key: string, q: ArrivalQuery, cityOverride?: string): Promise<UnifiedArrival[]> {
  const cityCode = tagoCityCode(q, cityOverride);
  const nodeId = await resolveTagoNodeId(key, cityCode, q);
  const url = buildUrl(TAGO_ARRIVAL_ALL_URL, {
    serviceKey: key,
    cityCode,
    nodeId,
    numOfRows: 50,
    pageNo: 1,
    _type: 'json',
  });
  const items = parseTagoResponse(await httpGet(url));
  const want = new Set(q.routes.map((r) => r.toUpperCase()));
  const out: UnifiedArrival[] = [];
  for (const it of items) {
    const routeNo = str(it.routeno);
    if (want.size && !want.has(routeNo.toUpperCase())) continue;
    if (it.arrtime === undefined || it.arrtime === null || it.arrtime === '') continue;
    out.push({
      regionLabel: cityCode === '25' ? '대전/TAGO' : `TAGO(${cityCode})`,
      stopName: q.stopName || str(it.nodenm, q.stopNo),
      stopNo: q.stopNo,
      routeNo,
      arrSec: Number(it.arrtime),
      prevStationCnt: str(it.arrprevstationcnt, '?'),
      vehicleType: str(it.vehicletp, '일반버스'),
      vehicleIdOrPlate: str(it.vehicleno),
      extraInfo: `노선유형: ${str(it.routetp, '시내버스')}`,
      routeType: str(it.routetp).replace(/버스$/, ''),
    });
  }
  return out.sort((a, b) => a.arrSec - b.arrSec);
}

// ───────────────────────────── GBIS (경기/성남) ─────────────────────────────

function extractGbisList(json: unknown, listKey: string): Item[] {
  const body = (json as { response?: { msgBody?: Record<string, unknown>; msgHeader?: Record<string, unknown> } })
    ?.response;
  const header = body?.msgHeader;
  const code = str(header?.resultCode);
  if (code && code !== '0' && code !== '4') {
    // 4 = 결과 없음
    throw new BusApiError(`GBIS 오류: ${str(header?.resultMessage, code)}`);
  }
  return asArray(body?.msgBody?.[listKey] as Item | Item[]);
}

async function lookupGbisStop(key: string, stopNo: string): Promise<StopInfo | null> {
  const url = buildUrl(GBIS_STATION_LIST_URL, { serviceKey: key, keyword: stopNo, format: 'json' });
  const text = await httpGet(url);
  if (!text.trim().startsWith('{')) parseTagoResponse(text); // XML 인증 오류 메시지 해석
  const stations = extractGbisList(JSON.parse(text), 'busStationList');
  for (const st of stations) {
    if (str(st.mobileNo) === stopNo) {
      const name = str(st.stationName, stopNo);
      return {
        stopNo,
        stopName: `${name} (${str(st.regionName, '경기')}, ${stopNo})`,
        stationId: str(st.stationId),
        latitude: num(st.y),
        longitude: num(st.x),
      };
    }
  }
  return null;
}

const GBIS_ROUTE_TYPES: Record<string, string> = {
  '11': '직행좌석', '12': '좌석', '13': '일반', '14': '광역급행', '15': '따복', '16': '순환',
  '21': '농어촌', '22': '농어촌', '23': '농어촌', '30': '마을', '41': '고속', '42': '시외', '43': '시외',
  '51': '공항', '52': '공항', '53': '공항',
};
const SEOUL_ROUTE_TYPES: Record<string, string> = {
  '1': '공항', '2': '마을', '3': '간선', '4': '지선', '5': '순환', '6': '광역', '7': '인천', '8': '경기', '0': '공용',
};

const LOW_PLATE: Record<string, string> = { '0': '일반버스', '1': '저상버스', '2': '2층버스', '7': '트롤리버스' };

async function fetchGbisArrivals(key: string, q: ArrivalQuery): Promise<UnifiedArrival[]> {
  try {
    let stationId = q.stationId;
    let stopName = q.stopName;
    if (!stationId) {
      const info = await lookupGbisStop(key, q.stopNo);
      if (!info?.stationId) {
        throw new BusApiError(`[성남/경기] 정류소 번호 '${q.stopNo}'에 해당하는 stationId를 찾지 못했습니다.`);
      }
      stationId = info.stationId;
      stopName = stopName || info.stopName;
    }
    const url = buildUrl(GBIS_ARRIVAL_LIST_URL, { serviceKey: key, stationId, format: 'json' });
    const text = await httpGet(url);
    if (!text.trim().startsWith('{')) parseTagoResponse(text);
    const items = extractGbisList(JSON.parse(text), 'busArrivalList');
    const want = new Set(q.routes.map((r) => r.toUpperCase()));
    const out: UnifiedArrival[] = [];
    for (const it of items) {
      const routeNm = str(it.routeName);
      if (want.size && !want.has(routeNm.toUpperCase())) continue;
      const routeType = GBIS_ROUTE_TYPES[str(it.routeTypeCd)] ?? '';
      const dest = str(it.routeDestName);
      for (const n of ['1', '2']) {
        const pred = str(it[`predictTime${n}`]);
        if (!pred) continue;
        const plate = str(it[`plateNo${n}`]);
        const seatRaw = str(it[`remainSeatCnt${n}`]);
        const seat = Number(seatRaw);
        const extra: string[] = [];
        if (dest) extra.push(`종점방향: ${dest}`);
        if (seatRaw !== '' && Number.isFinite(seat) && seat >= 0) extra.push(`잔여좌석: ${seat}석`);
        if (plate) extra.push(`차량번호: ${plate}`);
        out.push({
          regionLabel: '성남/경기',
          stopName: stopName || `정류소(${q.stopNo})`,
          stopNo: q.stopNo,
          routeNo: routeNm,
          arrSec: Number(pred) * 60,
          prevStationCnt: str(it[`locationNo${n}`], '?'),
          vehicleType: LOW_PLATE[str(it[`lowPlate${n}`], '0')] ?? '일반버스',
          vehicleIdOrPlate: plate,
          extraInfo: extra.join(' | '),
          routeType,
        });
      }
    }
    return out.sort((a, b) => a.arrSec - b.arrSec);
  } catch (e) {
    if (q.region === 'seongnam') {
      // 원본: GBIS 실패 시 TAGO 성남시(31020) 코드로 폴백
      return fetchTagoArrivals(key, { ...q, stationId: '' }, '31020');
    }
    throw e;
  }
}

// ───────────────────────────── 서울 ─────────────────────────────

/** 원본 parse_seoul_arrmsg_seconds */
export function parseSeoulArrmsgSeconds(traTime: unknown, arrmsg: string): { sec: number | null; prevCnt: string } {
  const msg = (arrmsg || '').trim();
  if (['운행종료', '출발대기', '차고지'].some((c) => msg.includes(c))) return { sec: null, prevCnt: '-' };
  let prevCnt = '?';
  const br = msg.match(/\[(\d+)번째\s*전\]/);
  if (br) prevCnt = br[1];
  if (msg.includes('곧도착') || msg.includes('곧 도착')) return { sec: 30, prevCnt: '0 (곧도착)' };
  const ms = msg.match(/(\d+)분\s*(?:(\d+)초)?/);
  if (ms) return { sec: Number(ms[1]) * 60 + Number(ms[2] ?? 0), prevCnt };
  const t = str(traTime);
  if (/^\d+$/.test(t) && Number(t) > 0) return { sec: Number(t), prevCnt };
  return { sec: null, prevCnt };
}

async function fetchSeoulItems(key: string, stopNo: string): Promise<Item[]> {
  const url = buildUrl(SEOUL_STATION_UID_URL, { serviceKey: key, arsId: stopNo, resultType: 'json' });
  const text = (await httpGet(url)).trim();
  if (text.startsWith('{')) {
    const data = JSON.parse(text);
    const header = data?.msgHeader;
    const code = str(header?.headerCd);
    if (code && code !== '0' && code !== '4') throw new BusApiError(`서울 버스 API 오류: ${str(header?.headerMsg, code)}`);
    return asArray(data?.msgBody?.itemList as Item | Item[]);
  }
  const root = xml.parse(text);
  const headerCd = str(findDeep(root, 'headerCd'));
  if (headerCd && headerCd !== '0' && headerCd !== '4') {
    throw new BusApiError(`서울 버스 API 오류: ${str(findDeep(root, 'headerMsg'), headerCd)}`);
  }
  const errMsg = str(findDeep(root, 'returnAuthMsg'));
  if (errMsg && errMsg !== 'NORMAL_CODE') throw new BusApiError(`API 인증 오류: ${errMsg}`);
  const msgBody = findDeep(root, 'msgBody') as Record<string, unknown> | undefined;
  return asArray(msgBody?.itemList as Item | Item[]);
}

async function fetchSeoulArrivals(key: string, q: ArrivalQuery): Promise<UnifiedArrival[]> {
  const items = await fetchSeoulItems(key, q.stopNo);
  const want = new Set(q.routes.map((r) => r.toUpperCase()));
  const out: UnifiedArrival[] = [];
  for (const it of items) {
    const rtNm = str(it.rtNm);
    const abrv = str(it.busRouteAbrv);
    if (want.size && !want.has(rtNm.toUpperCase()) && !want.has(abrv.toUpperCase())) continue;
    const stNm = str(it.stNm, q.stopNo);
    const dir = str(it.adirection);
    const routeType = SEOUL_ROUTE_TYPES[str(it.routeType)] ?? '';
    for (const n of ['1', '2']) {
      const arrmsg = str(it[`arrmsg${n}`]);
      const { sec, prevCnt } = parseSeoulArrmsgSeconds(it[`traTime${n}`], arrmsg);
      if (sec === null) continue;
      const plain = str(it[`plainNo${n}`]);
      const extra = [`현황: ${arrmsg}`];
      if (dir) extra.push(`진행방향: ${dir}`);
      if (plain) extra.push(`차량번호: ${plain}`);
      out.push({
        regionLabel: '서울',
        stopName: q.stopName || (dir ? `${stNm} (${dir} 방면, ${q.stopNo})` : `${stNm} (${q.stopNo})`),
        stopNo: q.stopNo,
        routeNo: rtNm || abrv,
        arrSec: sec,
        prevStationCnt: prevCnt,
        vehicleType: '시내/광역버스',
        vehicleIdOrPlate: plain || str(it[`vehId${n}`]),
        extraInfo: extra.join(' | '),
        routeType,
      });
    }
  }
  return out.sort((a, b) => a.arrSec - b.arrSec);
}

// ───────────────────────────── 공개 API ─────────────────────────────

export function isGbisRegion(r: Region): boolean {
  return r === 'seongnam' || r === 'gyeonggi';
}

/** 원본 fetch_arrivals_for_target */
export async function fetchArrivals(serviceKey: string, q: ArrivalQuery): Promise<UnifiedArrival[]> {
  const key = normalizeServiceKey(serviceKey);
  if (!key) throw new BusApiError('공공데이터포털 API 키가 설정되지 않았습니다. 설정 화면에서 입력해 주세요.');
  const stopNo = q.stopNo.replace(/-/g, '').trim();
  const query = { ...q, stopNo };
  if (isGbisRegion(q.region)) return fetchGbisArrivals(key, query);
  if (q.region === 'seoul') return fetchSeoulArrivals(key, query);
  return fetchTagoArrivals(key, query);
}

/** 정류소 번호로 정류장 이름·내부ID·좌표 조회 (알림 설정 / 하차 알림용) */
export async function lookupStop(
  serviceKey: string,
  region: Region,
  stopNoRaw: string,
  cityCode = '',
): Promise<StopInfo> {
  const key = normalizeServiceKey(serviceKey);
  if (!key) throw new BusApiError('공공데이터포털 API 키가 설정되지 않았습니다. 설정 화면에서 입력해 주세요.');
  const stopNo = stopNoRaw.replace(/-/g, '').trim();
  if (!stopNo) throw new BusApiError('정류소 번호를 입력해 주세요.');

  if (region === 'seoul') {
    const items = await fetchSeoulItems(key, stopNo);
    if (!items.length) throw new BusApiError(`서울 정류소 번호 ${stopNo}를 찾지 못했습니다.`);
    const first = items[0];
    const dir = str(first.adirection);
    const stNm = str(first.stNm, stopNo);
    return {
      stopNo,
      stopName: dir ? `${stNm} (${dir} 방면)` : stNm,
      stationId: str(first.stId),
      latitude: num(first.gpsY),
      longitude: num(first.gpsX),
    };
  }

  if (isGbisRegion(region)) {
    try {
      const info = await lookupGbisStop(key, stopNo);
      if (info) return info;
    } catch (e) {
      if (region !== 'seongnam') throw e;
    }
    if (region === 'seongnam') {
      const info = await lookupTagoStop(key, '31020', stopNo);
      if (info) return info;
    }
    throw new BusApiError(`정류소 번호 ${stopNo}를 찾지 못했습니다.`);
  }

  const city = cityCode || TAGO_CITY_CODES[region] || '25';
  const info = await lookupTagoStop(key, city, stopNo);
  if (!info) throw new BusApiError(`도시코드 ${city}에서 정류소 번호 ${stopNo}를 찾지 못했습니다.`);
  return info;
}

// ───────────────────────────── 정류장 검색 · 주변 정류장 · 방면 ─────────────────────────────

const TAGO_NEARBY_URL = 'http://apis.data.go.kr/1613000/BusSttnInfoInqireService/getCrdntPrxmtSttnList';
const TAGO_STOP_ROUTES_URL = 'http://apis.data.go.kr/1613000/BusSttnInfoInqireService/getSttnThrghRouteList';
const TAGO_ROUTE_STOPS_URL = 'http://apis.data.go.kr/1613000/BusRouteInfoInqireService/getRouteAcctoThrghSttnList';
const GBIS_STATION_AROUND_URL = 'https://apis.data.go.kr/6410000/busstationservice/v2/getBusStationAroundListv2';
const SEOUL_STATION_BY_NAME_URL = 'http://ws.bus.go.kr/api/rest/stationinfo/getStationByName';
const SEOUL_STATION_BY_POS_URL = 'http://ws.bus.go.kr/api/rest/stationinfo/getStationByPos';

/** TAGO 도시코드 → 앱 권역 */
const CITY_CODE_TO_REGION: Record<string, Region> = {
  '25': 'daejeon',
  '12': 'sejong',
  '22': 'daegu',
  '23': 'incheon',
  '24': 'gwangju',
  '26': 'ulsan',
  '31020': 'seongnam',
};

function requireKey(serviceKey: string): string {
  const key = normalizeServiceKey(serviceKey);
  if (!key) throw new BusApiError('공공데이터포털 API 키가 설정되지 않았습니다. 설정 화면에서 입력해 주세요.');
  return key;
}

async function seoulItems(url: string): Promise<Item[]> {
  const text = (await httpGet(url)).trim();
  if (text.startsWith('{')) {
    const data = JSON.parse(text);
    const code = str(data?.msgHeader?.headerCd);
    if (code && code !== '0' && code !== '4') throw new BusApiError(`서울 버스 API 오류: ${str(data?.msgHeader?.headerMsg, code)}`);
    return asArray(data?.msgBody?.itemList as Item | Item[]);
  }
  const root = xml.parse(text);
  const headerCd = str(findDeep(root, 'headerCd'));
  if (headerCd && headerCd !== '0' && headerCd !== '4') {
    throw new BusApiError(`서울 버스 API 오류: ${str(findDeep(root, 'headerMsg'), headerCd)}`);
  }
  const errMsg = str(findDeep(root, 'returnAuthMsg'));
  if (errMsg && errMsg !== 'NORMAL_CODE') throw new BusApiError(`API 인증 오류: ${errMsg}`);
  const body = findDeep(root, 'msgBody') as Record<string, unknown> | undefined;
  return asArray(body?.itemList as Item | Item[]);
}

async function gbisList(url: string, listKey: string): Promise<Item[]> {
  const text = await httpGet(url);
  if (!text.trim().startsWith('{')) parseTagoResponse(text); // XML 오류 메시지 해석
  return extractGbisList(JSON.parse(text), listKey);
}

function tagoStop(it: Item, region: Region, cityCode: string): StopCandidate {
  return {
    region,
    cityCode,
    stopNo: str(it.nodeno),
    stopName: str(it.nodenm),
    stationId: str(it.nodeid),
    latitude: num(it.gpslati),
    longitude: num(it.gpslong),
  };
}

function gbisStop(it: Item, region: Region): StopCandidate {
  return {
    region,
    cityCode: '',
    stopNo: str(it.mobileNo),
    stopName: str(it.stationName),
    stationId: str(it.stationId),
    latitude: num(it.y),
    longitude: num(it.x),
    distanceM: num(it.distance),
  };
}

/** 정류장 이름으로 검색 (예: "명석고") */
export async function searchStopsByName(
  serviceKey: string,
  region: Region,
  name: string,
  cityCode = '',
): Promise<StopCandidate[]> {
  const key = requireKey(serviceKey);
  const q = name.trim();
  if (!q) return [];
  // 숫자만 입력하면 정류소 번호 검색
  if (/^\d{4,6}$/.test(q.replace(/-/g, ''))) {
    try {
      const info = await lookupStop(key, region, q, cityCode);
      return [{ region, cityCode: cityCode || TAGO_CITY_CODES[region] || '', ...info }];
    } catch {
      // 이름 검색으로 계속
    }
  }

  if (region === 'seoul') {
    const items = await seoulItems(buildUrl(SEOUL_STATION_BY_NAME_URL, { serviceKey: key, stSrch: q, resultType: 'json' }));
    return items.slice(0, 40).map((it) => ({
      region,
      cityCode: '',
      stopNo: str(it.arsId),
      stopName: str(it.stNm),
      stationId: str(it.stId),
      latitude: num(it.tmY),
      longitude: num(it.tmX),
    }));
  }

  if (isGbisRegion(region)) {
    const items = await gbisList(
      buildUrl(GBIS_STATION_LIST_URL, { serviceKey: key, keyword: q, format: 'json' }),
      'busStationList',
    );
    return items.slice(0, 40).map((it) => gbisStop(it, region));
  }

  const city = cityCode || TAGO_CITY_CODES[region] || '25';
  const items = parseTagoResponse(
    await httpGet(
      buildUrl(TAGO_STOP_SEARCH_URL, { serviceKey: key, cityCode: city, nodeNm: q, numOfRows: 40, pageNo: 1, _type: 'json' }),
    ),
  );
  return items.map((it) => tagoStop(it, region, city));
}

/** 좌표 주변 정류장 (지도에서 선택) */
export async function nearbyStops(
  serviceKey: string,
  region: Region,
  latitude: number,
  longitude: number,
): Promise<StopCandidate[]> {
  const key = requireKey(serviceKey);

  if (region === 'seoul') {
    const items = await seoulItems(
      buildUrl(SEOUL_STATION_BY_POS_URL, { serviceKey: key, tmX: longitude, tmY: latitude, radius: 500, resultType: 'json' }),
    );
    return items.slice(0, 40).map((it) => ({
      region,
      cityCode: '',
      stopNo: str(it.arsId),
      stopName: str(it.stationNm),
      stationId: str(it.stationId),
      latitude: num(it.gpsY),
      longitude: num(it.gpsX),
      distanceM: num(it.dist),
    }));
  }

  if (isGbisRegion(region)) {
    const items = await gbisList(
      buildUrl(GBIS_STATION_AROUND_URL, { serviceKey: key, x: longitude, y: latitude, format: 'json' }),
      'busStationAroundList',
    );
    return items.slice(0, 40).map((it) => gbisStop(it, region));
  }

  // TAGO: 도시코드 없이 좌표만으로 조회되며, 결과에 도시코드가 포함된다
  const items = parseTagoResponse(
    await httpGet(
      buildUrl(TAGO_NEARBY_URL, { serviceKey: key, gpsLati: latitude, gpsLong: longitude, numOfRows: 40, pageNo: 1, _type: 'json' }),
    ),
  );
  return items.map((it) => {
    const city = str(it.citycode, TAGO_CITY_CODES[region] || '');
    return tagoStop(it, CITY_CODE_TO_REGION[city] ?? region, city);
  });
}

/**
 * 정류장의 진행 방향("○○ 방면")과 지나는 노선.
 *  - TAGO: 경유 노선 → 노선의 정류장 순서에서 다음 정류장
 *  - 서울: 도착정보의 다음 정류장(nxtStn)
 *  - 경기: 도착정보의 노선 종점 방향(routeDestName)
 */
export async function stopDirection(serviceKey: string, stop: StopCandidate): Promise<StopDirection> {
  const key = requireKey(serviceKey);

  if (stop.region === 'seoul') {
    const items = await fetchSeoulItems(key, stop.stopNo);
    const routes = [...new Set(items.map((it) => str(it.rtNm) || str(it.busRouteAbrv)).filter(Boolean))];
    const nexts = items.map((it) => str(it.nxtStn)).filter(Boolean);
    const next = mostCommon(nexts);
    const dir = mostCommon(items.map((it) => str(it.adirection)).filter(Boolean));
    return {
      label: next ? `${next} 방면` : dir ? `${dir} 방향` : '',
      nextStopName: next,
      routes,
    };
  }

  if (isGbisRegion(stop.region)) {
    const items = await gbisList(
      buildUrl(GBIS_ARRIVAL_LIST_URL, { serviceKey: key, stationId: stop.stationId, format: 'json' }),
      'busArrivalList',
    );
    const routes = [...new Set(items.map((it) => str(it.routeName)).filter(Boolean))];
    const dests = [...new Set(items.map((it) => str(it.routeDestName)).filter(Boolean))];
    return {
      label: dests.length ? `${dests.slice(0, 2).join('·')}${dests.length > 2 ? ' 등' : ''} 방면` : '',
      routes,
    };
  }

  const city = stop.cityCode || TAGO_CITY_CODES[stop.region] || '25';
  const routeItems = parseTagoResponse(
    await httpGet(
      buildUrl(TAGO_STOP_ROUTES_URL, { serviceKey: key, cityCode: city, nodeid: stop.stationId, numOfRows: 60, pageNo: 1, _type: 'json' }),
    ),
  );
  const routes = [...new Set(routeItems.map((it) => str(it.routeno)).filter(Boolean))].sort(routeSort);
  // 앞쪽 노선 몇 개로 다음 정류장을 찾는다 (회차 지점 등 예외 대비)
  for (const r of routeItems.slice(0, 3)) {
    try {
      const stops = parseTagoResponse(
        await httpGet(
          buildUrl(TAGO_ROUTE_STOPS_URL, { serviceKey: key, cityCode: city, routeId: str(r.routeid), numOfRows: 500, pageNo: 1, _type: 'json' }),
        ),
      ).sort((a, b) => Number(a.nodeord) - Number(b.nodeord));
      const idx = stops.findIndex((s) => str(s.nodeid) === stop.stationId);
      const next = idx >= 0 ? stops[idx + 1] : undefined;
      if (next) {
        return {
          label: `${str(next.nodenm)} 방면`,
          nextStopName: str(next.nodenm),
          nextLatitude: num(next.gpslati),
          nextLongitude: num(next.gpslong),
          routes,
        };
      }
    } catch {
      // 노선정보 API 미신청 등 → 다음 노선 시도
    }
  }
  return { label: '', routes };
}

function mostCommon(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | undefined;
  let bestN = 0;
  for (const [v, n] of counts) if (n > bestN) [best, bestN] = [v, n];
  return best;
}

function routeSort(a: string, b: string): number {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b, 'ko');
}

/** 기기 위치의 행정구역 이름 → 앱 권역 */
export function regionFromAddress(parts: (string | null | undefined)[]): Region | null {
  const s = parts.filter(Boolean).join(' ');
  if (/서울/.test(s)) return 'seoul';
  if (/성남/.test(s)) return 'seongnam';
  if (/경기/.test(s)) return 'gyeonggi';
  if (/대전/.test(s)) return 'daejeon';
  if (/세종/.test(s)) return 'sejong';
  if (/대구/.test(s)) return 'daegu';
  if (/인천/.test(s)) return 'incheon';
  if (/광주/.test(s)) return 'gwangju';
  if (/울산/.test(s)) return 'ulsan';
  return null;
}
