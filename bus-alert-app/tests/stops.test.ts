import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { nearbyStops, regionFromAddress, searchStopsByName, stopDirection } from '../src/core/busApi';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const hit = Object.keys(routes).find((k) => url.includes(k));
    if (!hit) return new Response('not mocked', { status: 404 });
    return new Response(JSON.stringify(routes[hit]), { status: 200 });
  }) as typeof fetch;
  return calls;
}

const tago = (items: unknown) => ({
  response: { header: { resultCode: '00' }, body: { items: { item: items } } },
});

describe('정류장 이름 검색 (TAGO)', () => {
  it('nodeNm 으로 검색하고 같은 이름 두 정류장을 반환', async () => {
    const calls = mockFetch({
      getSttnNoList: tago([
        { nodeid: 'DJB8001610', nodenm: '명석고등학교', nodeno: 11690, gpslati: 36.31, gpslong: 127.36 },
        { nodeid: 'DJB8001611', nodenm: '명석고등학교', nodeno: 51630, gpslati: 36.3102, gpslong: 127.3604 },
      ]),
    });
    const list = await searchStopsByName('KEY', 'daejeon', '명석고');
    assert.equal(list.length, 2);
    assert.equal(list[0].stationId, 'DJB8001610');
    assert.equal(list[0].stopNo, '11690');
    assert.equal(list[0].cityCode, '25');
    assert.match(calls[0], /nodeNm=%EB%AA%85%EC%84%9D%EA%B3%A0/);
  });
});

describe('주변 정류장 (TAGO 좌표)', () => {
  it('결과의 도시코드로 권역을 판별', async () => {
    mockFetch({
      getCrdntPrxmtSttnList: tago({ citycode: 12, nodeid: 'SJB1', nodenm: '세종시청', nodeno: '', gpslati: 36.48, gpslong: 127.29 }),
    });
    const list = await nearbyStops('KEY', 'daejeon', 36.48, 127.29);
    assert.equal(list[0].region, 'sejong');
    assert.equal(list[0].cityCode, '12');
  });
});

describe('방면 (TAGO 노선 순서의 다음 정류장)', () => {
  it('다음 정류장 이름과 좌표, 노선 목록', async () => {
    mockFetch({
      getSttnThrghRouteList: tago([
        { routeid: 'R311', routeno: '311' },
        { routeid: 'R102', routeno: '102' },
      ]),
      getRouteAcctoThrghSttnList: tago([
        { nodeid: 'A', nodenm: '앞정류장', nodeord: 9 },
        { nodeid: 'DJB8001610', nodenm: '명석고등학교', nodeord: 10 },
        { nodeid: 'C', nodenm: '대전역', nodeord: 11, gpslati: 36.33, gpslong: 127.43 },
      ]),
    });
    const d = await stopDirection('KEY', {
      region: 'daejeon', cityCode: '25', stopNo: '11690', stopName: '명석고등학교', stationId: 'DJB8001610',
    });
    assert.equal(d.label, '대전역 방면');
    assert.equal(d.nextLatitude, 36.33);
    assert.deepEqual(d.routes, ['102', '311']);
  });
});

describe('서울 방면', () => {
  it('nxtStn 최빈값', async () => {
    mockFetch({
      getStationByUid: {
        msgHeader: { headerCd: '0' },
        msgBody: { itemList: [
          { rtNm: '472', nxtStn: '강남역', adirection: '신촌' },
          { rtNm: '140', nxtStn: '강남역', adirection: '도봉산' },
          { rtNm: '9404', nxtStn: '신논현역', adirection: '분당' },
        ] },
      },
    });
    const d = await stopDirection('KEY', { region: 'seoul', cityCode: '', stopNo: '22009', stopName: '강남역', stationId: '1' });
    assert.equal(d.label, '강남역 방면');
    assert.equal(d.routes.length, 3);
  });
});

describe('regionFromAddress', () => {
  it('행정구역 이름 매핑', () => {
    assert.equal(regionFromAddress(['대전광역시', '서구']), 'daejeon');
    assert.equal(regionFromAddress(['경기도', '성남시']), 'seongnam');
    assert.equal(regionFromAddress(['경기도', '수원시']), 'gyeonggi');
    assert.equal(regionFromAddress(['서울특별시']), 'seoul');
    assert.equal(regionFromAddress(['제주특별자치도']), null);
  });
});

import { fetchArrivals } from '../src/core/busApi';
import { routeStyle } from '../src/core/routeStyle';

describe('노선 색상', () => {
  it('종류별 색상', () => {
    assert.equal(routeStyle('간선', '472').color, '#2F5DBA');
    assert.equal(routeStyle('지선', '3412').color, '#4CAF3E');
    assert.equal(routeStyle('광역급행', 'M4102').color, '#E0322B');
    assert.equal(routeStyle('', 'M4102').color, '#E0322B');
    assert.equal(routeStyle('마을', '서초09').label, '마을');
  });
});

describe('두 번째 버스', () => {
  it('서울 arrmsg2 / 노선종류', async () => {
    mockFetch({
      getStationByUid: {
        msgHeader: { headerCd: '0' },
        msgBody: { itemList: [{ rtNm: '472', routeType: '3', arrmsg1: '3분12초후[2번째 전]', arrmsg2: '12분후[7번째 전]', plainNo1: 'A', plainNo2: 'B' }] },
      },
    });
    const list = await fetchArrivals('KEY', { region: 'seoul', stopNo: '22009', routes: [] });
    assert.equal(list.length, 2);
    assert.equal(list[0].routeType, '간선');
    assert.equal(list[1].prevStationCnt, '7');
    assert.equal(list[1].vehicleIdOrPlate, 'B');
  });
  it('경기 predictTime2', async () => {
    mockFetch({
      getBusArrivalListv2: {
        response: { msgHeader: { resultCode: 0 }, msgBody: { busArrivalList: [
          { routeName: '9407', routeTypeCd: 11, predictTime1: 4, locationNo1: 2, plateNo1: 'P1', predictTime2: 20, locationNo2: 9, plateNo2: 'P2' },
        ] } },
      },
    });
    const list = await fetchArrivals('KEY', { region: 'gyeonggi', stopNo: '1', stationId: 'S', routes: [] });
    assert.deepEqual(list.map((a) => a.arrSec), [240, 1200]);
    assert.equal(list[0].routeType, '직행좌석');
  });
});

import { estimateTravelDirection } from '../src/core/geoDirection';

describe('방면 추정 (우측통행)', () => {
  const base = { region: 'daejeon' as const, cityCode: '25', stopNo: '', stopName: '명석고등학교' };
  it('도로 동쪽 정류장 → 북쪽 방향', () => {
    const east = { ...base, stationId: 'E', latitude: 36.31, longitude: 127.3604 };
    const west = { ...base, stationId: 'W', latitude: 36.31, longitude: 127.3600 };
    assert.match(estimateTravelDirection(east, [east, west])!.label, /^북쪽/);
    assert.match(estimateTravelDirection(west, [east, west])!.label, /^남쪽/);
  });
  it('짝이 없으면 null', () => {
    const a = { ...base, stationId: 'A', latitude: 36.31, longitude: 127.36 };
    assert.equal(estimateTravelDirection(a, [a]), null);
  });
  it('노선정보 API 미신청 시 안내 문구 + 위치 추정', async () => {
    const authErr =
      '<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>';
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('getSttnThrghRouteList')) return new Response(JSON.stringify(tago([{ routeid: 'R1', routeno: '311' }])));
      if (url.includes('getRouteAcctoThrghSttnList')) return new Response(authErr);
      return new Response('x', { status: 404 });
    }) as typeof fetch;
    const east = { ...base, stationId: 'E', latitude: 36.31, longitude: 127.3604 };
    const west = { ...base, stationId: 'W', latitude: 36.31, longitude: 127.36 };
    const d = await stopDirection('KEY', east, [east, west]);
    assert.match(d.label, /북쪽 방향/);
    assert.equal(d.estimated, true);
    assert.match(d.note ?? '', /버스노선정보/);
    assert.deepEqual(d.routes, ['311']);
  });
});

import { pickNextStop, type RouteCounts } from '../src/core/busApi';

// 2026-11-09 실제 조회값 (tools/api_probe.py, 대전 TAGO) "노선:남은정거장/초"
function parse(s: string): RouteCounts {
  const out: RouteCounts = {};
  for (const p of s.trim().split(/\s+/)) {
    const [r, rest] = p.split(':');
    const [cnt, sec] = rest.split('/').map(Number);
    out[r] = { cnt, sec };
  }
  return out;
}
const REAL = {
  '11690': parse('103:4/369 105:2/1346 106:1/37 311:3/168 613:3/145 620:11/1354 66:4/1410'),
  '51630': parse('103:4/335 105:2/126 106:7/626 311:1/39 613:2/126 620:3/256 66:9/775'),
  '길치근린공원네거리53510': parse('66:9/715'),
  '평화아파트53530': parse('66:9/1400'),
  '길치근린공원51640': parse('103:5/416 105:3/207 106:8/707 311:2/120 613:3/207 620:4/337 66:10/856'),
  '평화아파트11620': parse('105:1/1346 66:8/607'),
  '길치근린공원51620': parse('103:3/313 106:3/1350 311:2/112 613:2/89 620:10/1354 66:3/1410'),
  '한국폴리텍대학11650': parse('103:3/271 105:1/62 106:6/562 311:5/503 613:1/62 620:2/192 66:8/711'),
  '한국폴리텍대학11640': parse('103:5/448 105:3/1346 106:2/116 311:1/48 613:4/224 620:12/1354 66:5/1410'),
};

describe('도착정보로 다음 정류장 찾기 (명석고 실제 데이터)', () => {
  const others = (self: string) =>
    Object.entries(REAL)
      .filter(([k]) => k !== self && k !== (self === '11690' ? '51630' : '11690'))
      .map(([k, counts]) => ({ stop: k, counts }));
  it('명석고 11690 → 한국폴리텍대학 방면', () => {
    assert.equal(pickNextStop(REAL['11690'], others('11690'))?.stop, '한국폴리텍대학11640');
  });
  it('명석고 51630 → 길치근린공원 방면', () => {
    assert.equal(pickNextStop(REAL['51630'], others('51630'))?.stop, '길치근린공원51640');
  });
  it('맞은편 정류장까지 섞여 있어도 같은 결과', () => {
    const all = (self: string) => Object.entries(REAL).filter(([k]) => k !== self).map(([k, counts]) => ({ stop: k, counts }));
    assert.equal(pickNextStop(REAL['11690'], all('11690'))?.stop, '한국폴리텍대학11640');
    assert.equal(pickNextStop(REAL['51630'], all('51630'))?.stop, '길치근린공원51640');
  });
});
