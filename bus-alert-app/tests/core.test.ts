import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseSeoulArrmsgSeconds, parseTagoResponse } from '../src/core/busApi';
import { decideAlarmNotifications, decideRide, emptyAlarmState, emptyRideState } from '../src/core/decide';
import { getActiveWindow, getNextWindowStart } from '../src/core/schedule';
import type { BusAlarm, RideAlert, UnifiedArrival } from '../src/core/types';

const alarm = (p: Partial<BusAlarm> = {}): BusAlarm => ({
  id: 'a1', label: '출근', enabled: true, region: 'daejeon', stopNo: '11690', stopName: '명석고',
  stationId: '', cityCode: '', routes: ['311'],
  windowStart: { hour: 7, minute: 20 }, windowEnd: { hour: 7, minute: 40 }, days: [1, 2, 3, 4, 5],
  stopAlerts: [], thresholdMin: 5, pollIntervalSec: 60, repeatIntervalMin: 0, sendStartSummary: false, createdAt: 0, ...p,
});
const arr = (p: Partial<UnifiedArrival> = {}): UnifiedArrival => ({
  regionLabel: '대전', stopName: '명석고', stopNo: '11690', routeNo: '311', arrSec: 240,
  prevStationCnt: '2', vehicleType: '', vehicleIdOrPlate: '', extraInfo: '', ...p,
});

describe('schedule', () => {
  it('weekday window', () => {
    // 2026-11-09 = 월요일
    assert.ok(getActiveWindow(alarm(), new Date(2026, 10, 9, 7, 30)));
    assert.equal(getActiveWindow(alarm(), new Date(2026, 10, 9, 7, 40)), null);
    assert.equal(getActiveWindow(alarm(), new Date(2026, 10, 8, 7, 30)), null); // 일요일
  });
  it('overnight window belongs to start day', () => {
    const a = alarm({ windowStart: { hour: 23, minute: 0 }, windowEnd: { hour: 1, minute: 0 }, days: [5] }); // 금
    const w = getActiveWindow(a, new Date(2026, 10, 14, 0, 30)); // 토 00:30
    assert.equal(w?.sessionKey, '2026-11-13');
    assert.equal(getActiveWindow(a, new Date(2026, 10, 15, 0, 30)), null);
  });
  it('next start skips non-selected days', () => {
    const n = getNextWindowStart(alarm(), new Date(2026, 10, 13, 8, 0)); // 금 08:00 → 월
    assert.deepEqual([n?.getDate(), n?.getHours(), n?.getMinutes()], [16, 7, 20]);
  });
});

describe('decideAlarmNotifications', () => {
  const end = new Date();
  it('notifies once per bus by default', () => {
    let r = decideAlarmNotifications(alarm(), [arr({ arrSec: 400 })], emptyAlarmState(), 's', end, 0);
    assert.equal(r.notifications.length, 0);
    r = decideAlarmNotifications(alarm(), [arr({ arrSec: 280 })], r.state, 's', end, 60_000);
    assert.equal(r.notifications.length, 1);
    r = decideAlarmNotifications(alarm(), [arr({ arrSec: 60 })], r.state, 's', end, 120_000);
    assert.equal(r.notifications.length, 0);
    // 다음 버스: 남은 시간이 120초 이상 늘어남
    r = decideAlarmNotifications(alarm(), [arr({ arrSec: 290 })], r.state, 's', end, 180_000);
    assert.equal(r.notifications.length, 1);
  });
  it('uses plate number when available', () => {
    let r = decideAlarmNotifications(alarm(), [arr({ vehicleIdOrPlate: 'A' })], emptyAlarmState(), 's', end, 0);
    assert.equal(r.notifications.length, 1);
    r = decideAlarmNotifications(alarm(), [arr({ arrSec: 100, vehicleIdOrPlate: 'B' })], r.state, 's', end, 60_000);
    assert.equal(r.notifications.length, 1);
  });
  it('repeats every N minutes for the same bus', () => {
    const a = alarm({ repeatIntervalMin: 2 });
    let r = decideAlarmNotifications(a, [arr({ arrSec: 280 })], emptyAlarmState(), 's', end, 0);
    r = decideAlarmNotifications(a, [arr({ arrSec: 220 })], r.state, 's', end, 60_000);
    assert.equal(r.notifications.length, 0);
    r = decideAlarmNotifications(a, [arr({ arrSec: 160 })], r.state, 's', end, 120_000);
    assert.equal(r.notifications.length, 1);
    assert.match(r.notifications[0].title, /반복/);
  });
  it('start summary once per session and resets on new session', () => {
    const a = alarm({ sendStartSummary: true });
    let r = decideAlarmNotifications(a, [arr({ arrSec: 900 })], emptyAlarmState(), 's1', end, 0);
    assert.equal(r.notifications.length, 1);
    r = decideAlarmNotifications(a, [arr({ arrSec: 840 })], r.state, 's1', end, 60_000);
    assert.equal(r.notifications.length, 0);
    r = decideAlarmNotifications(a, [arr({ arrSec: 840 })], r.state, 's2', end, 120_000);
    assert.equal(r.notifications.length, 1);
  });
});

describe('N정거장 전 알림', () => {
  const end = new Date();
  const a = alarm({ stopAlerts: [3, 2], thresholdMin: 0 });
  it('3정거장 전, 2정거장 전에 각각 1회', () => {
    let r = decideAlarmNotifications(a, [arr({ prevStationCnt: '5', arrSec: 600 })], emptyAlarmState(), 's', end, 0);
    assert.equal(r.notifications.length, 0);
    r = decideAlarmNotifications(a, [arr({ prevStationCnt: '3', arrSec: 400 })], r.state, 's', end, 60_000);
    assert.equal(r.notifications.length, 1);
    assert.match(r.notifications[0].title, /3정거장 전/);
    r = decideAlarmNotifications(a, [arr({ prevStationCnt: '3', arrSec: 350 })], r.state, 's', end, 120_000);
    assert.equal(r.notifications.length, 0);
    r = decideAlarmNotifications(a, [arr({ prevStationCnt: '2', arrSec: 250 })], r.state, 's', end, 180_000);
    assert.equal(r.notifications.length, 1);
    assert.match(r.notifications[0].title, /2정거장 전/);
    r = decideAlarmNotifications(a, [arr({ prevStationCnt: '1', arrSec: 100 })], r.state, 's', end, 240_000);
    assert.equal(r.notifications.length, 0);
  });
  it('다음 버스(정거장 수가 다시 늘어남)는 처음부터 다시 알림', () => {
    let r = decideAlarmNotifications(a, [arr({ prevStationCnt: '2', arrSec: 200 })], emptyAlarmState(), 's', end, 0);
    assert.equal(r.notifications.length, 1);
    r = decideAlarmNotifications(a, [arr({ prevStationCnt: '1', arrSec: 60 })], r.state, 's', end, 60_000);
    r = decideAlarmNotifications(a, [arr({ prevStationCnt: '3', arrSec: 500 })], r.state, 's', end, 120_000);
    assert.equal(r.notifications.length, 1);
    assert.match(r.notifications[0].title, /3정거장 전/);
  });
  it('여러 단계를 한 번에 건너뛰면 1회만', () => {
    const r = decideAlarmNotifications(a, [arr({ prevStationCnt: '1', arrSec: 90 })], emptyAlarmState(), 's', end, 0);
    assert.equal(r.notifications.length, 1);
    assert.match(r.notifications[0].title, /1정거장 전/);
    assert.deepEqual(r.state.routes['311'].notifiedStages, [3, 2]);
  });
  it('정거장 알림과 분 알림이 같이 걸리면 중복 없이 1건', () => {
    const b = alarm({ stopAlerts: [2], thresholdMin: 5 });
    const r = decideAlarmNotifications(b, [arr({ prevStationCnt: '2', arrSec: 200 })], emptyAlarmState(), 's', end, 0);
    assert.equal(r.notifications.length, 1);
  });
});

describe('decideRide (도착정보 기반 하차 알림)', () => {
  const ride: RideAlert = {
    active: true, region: 'daejeon', cityCode: '25', stopNo: '1', stationId: 'X', stopName: '목적지',
    routeNo: '311', stopAlerts: [3, 2, 1], arriveAlert: true, pollIntervalSec: 30, startedAt: 0,
  };
  it('3→2→1정거장, 곧 도착이면 지금 내리세요 후 종료', () => {
    let r = decideRide(ride, emptyRideState(), [arr({ prevStationCnt: '4', arrSec: 500 })], 0);
    assert.equal(r.notifications.length, 0);
    r = decideRide(ride, r.state, [arr({ prevStationCnt: '3', arrSec: 380 })], 1);
    assert.match(r.notifications[0].title, /3정거장/);
    r = decideRide(ride, r.state, [arr({ prevStationCnt: '2', arrSec: 250 })], 2);
    assert.match(r.notifications[0].title, /2정거장/);
    r = decideRide(ride, r.state, [arr({ prevStationCnt: '1', arrSec: 120 })], 3);
    assert.match(r.notifications[0].title, /1정거장/);
    assert.equal(r.finished, false);
    r = decideRide(ride, r.state, [arr({ prevStationCnt: '0 (곧도착)', arrSec: 30 })], 4);
    assert.match(r.notifications[0].title, /지금 내리세요/);
    assert.equal(r.finished, true);
  });
  it('다른 노선은 무시', () => {
    const r = decideRide(ride, emptyRideState(), [arr({ routeNo: '102', prevStationCnt: '1', arrSec: 60 })], 0);
    assert.equal(r.notifications.length, 0);
  });
  it('차량번호 없는 지역: 1정거장 전이던 버스가 사라지고 다음 버스가 잡히면 종료', () => {
    let r = decideRide(ride, emptyRideState(), [arr({ prevStationCnt: '1', arrSec: 90 })], 0);
    r = decideRide(ride, r.state, [arr({ prevStationCnt: '7', arrSec: 900 })], 1);
    assert.equal(r.finished, true);
    assert.match(r.notifications[0].title, /내릴 정류장입니다/);
  });
  it('차량번호로 내 버스를 고정 추적 (앞 버스는 무시)', () => {
    let st = { ...emptyRideState(), skipBuses: 1 };
    let r = decideRide(ride, st, [
      arr({ prevStationCnt: '1', arrSec: 60, vehicleIdOrPlate: 'AHEAD' }),
      arr({ prevStationCnt: '5', arrSec: 600, vehicleIdOrPlate: 'MINE' }),
    ], 0);
    assert.equal(r.state.trackedPlate, 'MINE');
    assert.equal(r.notifications.length, 0);
    r = decideRide(ride, r.state, [
      arr({ prevStationCnt: '0', arrSec: 10, vehicleIdOrPlate: 'AHEAD' }),
      arr({ prevStationCnt: '3', arrSec: 350, vehicleIdOrPlate: 'MINE' }),
    ], 1);
    assert.match(r.notifications[0].title, /3정거장/);
    assert.equal(r.finished, false);
  });
});

describe('parsers', () => {
  it('seoul arrmsg', () => {
    assert.deepEqual(parseSeoulArrmsgSeconds('0', '3분12초후[2번째 전]'), { sec: 192, prevCnt: '2' });
    assert.deepEqual(parseSeoulArrmsgSeconds('0', '곧 도착'), { sec: 30, prevCnt: '0 (곧도착)' });
    assert.equal(parseSeoulArrmsgSeconds('0', '운행종료').sec, null);
  });
  it('tago json single item', () => {
    const items = parseTagoResponse(JSON.stringify({
      response: { header: { resultCode: '00' }, body: { items: { item: { routeno: 311, arrtime: 120 } } } },
    }));
    assert.equal(items.length, 1);
  });
  it('tago xml auth error', () => {
    const xml = '<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>';
    assert.throws(() => parseTagoResponse(xml), /SERVICE_KEY_IS_NOT_REGISTERED_ERROR/);
  });
});
