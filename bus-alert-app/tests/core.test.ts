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
  thresholdMin: 5, pollIntervalSec: 60, repeatIntervalMin: 0, sendStartSummary: false, createdAt: 0, ...p,
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

describe('decideRide', () => {
  const ride: RideAlert = {
    active: true, region: 'daejeon', stopNo: '1', stopName: '목적지', latitude: 36.35, longitude: 127.38,
    radiusM: 200, preAlertM: 800, repeatCount: 2, repeatIntervalSec: 20, startedAt: 0, routeNo: '',
  };
  it('pre-alert, arrive, repeat, finish', () => {
    let r = decideRide(ride, emptyRideState(), { latitude: 36.355, longitude: 127.38 }, 0); // ~556m
    assert.equal(r.notifications[0]?.key, 'ride:pre');
    r = decideRide(ride, r.state, { latitude: 36.3505, longitude: 127.38 }, 1000); // ~56m
    assert.equal(r.notifications[0]?.key, 'ride:arrived');
    assert.equal(r.finished, false);
    r = decideRide(ride, r.state, null, 10_000);
    assert.equal(r.notifications.length, 0);
    r = decideRide(ride, r.state, null, 21_000);
    assert.equal(r.notifications.length, 1);
    assert.equal(r.finished, true);
  });
  it('geofence forces arrival', () => {
    const r = decideRide(ride, emptyRideState(), null, 0, true);
    assert.equal(r.notifications[0]?.key, 'ride:arrived');
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
