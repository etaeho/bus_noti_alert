#!/usr/bin/env python3
"""
명석고등학교(대전 11690) 기준으로 공공데이터 버스 API 가 주는 정보를 모두 출력한다.
(API 키는 절대 출력하지 않는다 - URL/예외 메시지에서도 제거)
"""
import json
import os
import urllib.parse

import requests

RAW = os.environ.get("DATA_GO_KR_API_KEY", "").strip()
KEY = urllib.parse.unquote(RAW) if RAW else ""
SECRETS = {s for s in [RAW, KEY, urllib.parse.quote(KEY, safe=""), urllib.parse.quote_plus(KEY)] if s}

CITY = "25"
STOP_NO = "11690"
NAME = "명석고"
CANDIDATE_NODE_IDS = ["DJB8001611", "DJB8001612"]


def clean(text: str) -> str:
    for s in SECRETS:
        text = text.replace(s, "***")
    return text


def call(name: str, url: str, params: dict, quiet: bool = False) -> list:
    import time
    for attempt in range(3):
        items, code = _call(name, url, params, quiet)
        if code != "99":
            return items
        print("   (resultCode 99 → 2초 후 재시도)")
        time.sleep(2)
    return items


def _call(name: str, url: str, params: dict, quiet: bool):
    if not quiet:
        print(f"\n{'=' * 70}\n▶ {name}\n   {url.split('/')[-2]}/{url.split('/')[-1]}  params={ {k: v for k, v in params.items()} }")
    try:
        r = requests.get(url, params={"serviceKey": KEY, "_type": "json", **params}, timeout=15)
        body = r.text.strip()
        if not quiet:
            print(f"   HTTP {r.status_code}, {len(body)} bytes")
        if not body.startswith("{"):
            print("   (JSON 아님) " + clean(body[:400]))
            return [], ""
        data = r.json()
        header = data.get("response", {}).get("header", {})
        code = str(header.get("resultCode"))
        if not quiet or code not in ("00", "0"):
            print(f"   resultCode={code} resultMsg={header.get('resultMsg')}")
        items = (data.get("response", {}).get("body") or {}).get("items") or {}
        item = items.get("item", []) if isinstance(items, dict) else []
        if isinstance(item, dict):
            item = [item]
        if not quiet:
            print(f"   items: {len(item)}개")
            for it in item[:25]:
                print("   - " + json.dumps(it, ensure_ascii=False))
        return item, code
    except Exception as e:  # noqa: BLE001
        print("   오류: " + clean(str(e))[:300])
        return [], ""


def main() -> None:
    if not KEY:
        print("DATA_GO_KR_API_KEY 없음")
        return
    T = "http://apis.data.go.kr/1613000"
    # 1) 정류소 번호 / 이름 검색
    by_no = call("정류소 번호로 검색", f"{T}/BusSttnInfoInqireService/getSttnNoList", {"cityCode": CITY, "nodeNo": STOP_NO, "numOfRows": 20})
    by_nm = call("정류소 이름으로 검색", f"{T}/BusSttnInfoInqireService/getSttnNoList", {"cityCode": CITY, "nodeNm": NAME, "numOfRows": 20})
    nodes = {str(i.get("nodeid")): i for i in by_no + by_nm if i.get("nodeid")}
    for nid in CANDIDATE_NODE_IDS:
        nodes.setdefault(nid, {"nodeid": nid})

    # 2) 좌표 주변 정류소 + 각 정류소 도착정보 (다음 정류장 판별용)
    any_gps = next((i for i in nodes.values() if i.get("gpslati")), None)
    neighbors = []
    if any_gps:
        neighbors = call("좌표 주변 정류소", f"{T}/BusSttnInfoInqireService/getCrdntPrxmtSttnList",
                         {"gpsLati": any_gps["gpslati"], "gpsLong": any_gps["gpslong"], "numOfRows": 20})
    print(f"\n{'=' * 70}\n▶ 주변 정류소별 도착정보 (노선:남은정거장/초)")
    for n in neighbors:
        arr = call("", f"{T}/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList",
                   {"cityCode": CITY, "nodeId": n["nodeid"], "numOfRows": 40}, quiet=True)
        summary = " ".join(sorted(f"{a.get('routeno')}:{a.get('arrprevstationcnt')}/{a.get('arrtime')}" for a in arr))
        print(f"   {n.get('nodenm')} {n.get('nodeno', '')} [{n['nodeid']}] ({n.get('gpslati')},{n.get('gpslong')}) → {summary}")

    route_ids = {}
    for nid, info in nodes.items():
        label = f"{info.get('nodenm', '')} {info.get('nodeno', '')} [{nid}]"
        # 3) 정류소 경유 노선
        routes = call(f"경유 노선 - {label}", f"{T}/BusSttnInfoInqireService/getSttnThrghRouteList",
                      {"cityCode": CITY, "nodeid": nid, "numOfRows": 50})
        for r in routes:
            route_ids.setdefault(str(r.get("routeno")), str(r.get("routeid")))
        # 4) 도착 정보
        call(f"도착 정보 - {label}", f"{T}/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList",
             {"cityCode": CITY, "nodeId": nid, "numOfRows": 30})

    # 5) 311번 노선 정보 / 경유 정류소 순서
    rid = route_ids.get("311")
    call("노선번호 311 검색", f"{T}/BusRouteInfoInqireService/getRouteNoList", {"cityCode": CITY, "routeNo": "311", "numOfRows": 10})
    if rid:
        call("311 노선 기본정보", f"{T}/BusRouteInfoInqireService/getRouteInfoIem", {"cityCode": CITY, "routeId": rid})
        stops = call("311 경유 정류소 (전체)", f"{T}/BusRouteInfoInqireService/getRouteAcctoThrghSttnList",
                     {"cityCode": CITY, "routeId": rid, "numOfRows": 300})
        print("\n▶ 311번 노선에서 명석고 앞뒤 정류장")
        for i, s in enumerate(stops):
            if "명석고" in str(s.get("nodenm", "")):
                lo, hi = max(0, i - 2), min(len(stops), i + 4)
                for x in stops[lo:hi]:
                    print(f"   {x.get('nodeord')}. {x.get('nodenm')} ({x.get('nodeno')}, {x.get('nodeid')}) updowncd={x.get('updowncd')}")
                print("   ...")
        # 6) 버스 위치
        call("311 버스 위치", f"{T}/BusLcInfoInqireService/getRouteAcctoBusLcList", {"cityCode": CITY, "routeId": rid, "numOfRows": 50})


if __name__ == "__main__":
    main()
