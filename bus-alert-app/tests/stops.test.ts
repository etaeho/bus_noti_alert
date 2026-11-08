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
