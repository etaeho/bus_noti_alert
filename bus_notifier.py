#!/usr/bin/env python3
"""
전국 통합(대전·성남/경기·서울) 다중 정류장·다중 버스 노선
도착 N분 전 브리핑 & 텔레그램 자동 알림 스크립트 (GitHub Actions 배치 전용)
"""

from __future__ import annotations

import datetime
import json
import os
import re
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Any
from zoneinfo import ZoneInfo

import requests
from google import genai

KST = ZoneInfo("Asia/Seoul")

# Encoding/Decoding 인증키 모두 호환되도록 unquote 처리
RAW_DATA_API_KEY = os.getenv("DATA_GO_KR_API_KEY", "").strip()
DATA_GO_KR_API_KEY = urllib.parse.unquote(RAW_DATA_API_KEY) if RAW_DATA_API_KEY else ""
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "").strip()

ALERT_THRESHOLD_MIN = int(os.getenv("ALERT_THRESHOLD_MIN", "5"))
POLL_INTERVAL_SEC = int(os.getenv("POLL_INTERVAL_SEC", "60"))
WINDOW_START_HOUR = int(os.getenv("WINDOW_START_HOUR", "7"))
WINDOW_START_MIN = int(os.getenv("WINDOW_START_MIN", "20"))
WINDOW_END_HOUR = int(os.getenv("WINDOW_END_HOUR", "7"))
WINDOW_END_MIN = int(os.getenv("WINDOW_END_MIN", "40"))
BATCH_DURATION_MIN = int(os.getenv("BATCH_DURATION_MIN", "20"))
SEND_START_SUMMARY = os.getenv("SEND_START_SUMMARY", "true").lower() == "true"
RUN_ONCE_NOW = os.getenv("RUN_ONCE_NOW", "false").lower() == "true"

TAGO_CITY_CODES: dict[str, str] = {
    "daejeon": "25",
    "대전": "25",
    "sejong": "12",
    "세종": "12",
    "daegu": "22",
    "대구": "22",
    "incheon": "23",
    "인천": "23",
    "gwangju": "24",
    "광주": "24",
    "ulsan": "26",
    "울산": "26",
    "seongnam_tago": "31020",
}

TAGO_STOP_SEARCH_URL = (
    "http://apis.data.go.kr/1613000/BusSttnInfoInqireService/getSttnNoList"
)
TAGO_ROUTE_STOPS_URL = (
    "http://apis.data.go.kr/1613000/BusRouteInfoInqireService/getRouteAcctoThrghSttnList"
)
TAGO_ARRIVAL_ALL_URL = (
    "http://apis.data.go.kr/1613000/ArvlInfoInqireService/"
    "getSttnAcctoArvlPrearngeInfoList"
)
GBIS_STATION_LIST_URL = (
    "https://apis.data.go.kr/6410000/busstationservice/v2/getBusStationListv2"
)
GBIS_ARRIVAL_LIST_URL = (
    "https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalListv2"
)
SEOUL_STATION_UID_URL = (
    "http://ws.bus.go.kr/api/rest/stationinfo/getStationByUid"
)


@dataclass
class WatchTarget:
    region: str
    stop_no: str
    routes: list[str]
    stop_name: str = ""
    station_id: str = ""
    city_code: str = ""
    threshold_min: int = ALERT_THRESHOLD_MIN


@dataclass
class UnifiedArrival:
    region_label: str
    stop_name: str
    stop_no: str
    route_no: str
    arr_sec: int
    prev_station_cnt: str
    vehicle_type: str = "일반버스"
    vehicle_id_or_plate: str = ""
    extra_info: str = ""
    raw_fields: dict[str, Any] = field(default_factory=dict)


def load_watch_targets() -> list[WatchTarget]:
    targets_json = os.getenv("TARGETS_JSON", "").strip()
    if targets_json:
        raw_list = json.loads(targets_json)
        targets: list[WatchTarget] = []
        for item in raw_list:
            routes_val = item.get("routes") or item.get("route") or []
            if isinstance(routes_val, str):
                routes_list = [r.strip() for r in routes_val.split(",") if r.strip()]
            else:
                routes_list = [str(r).strip() for r in routes_val if str(r).strip()]
            targets.append(
                WatchTarget(
                    region=str(item.get("region", "daejeon")).strip().lower(),
                    stop_no=str(item.get("stop_no", "")).replace("-", "").strip(),
                    routes=routes_list,
                    stop_name=str(item.get("stop_name", "")).strip(),
                    station_id=str(item.get("station_id", "")).strip(),
                    city_code=str(item.get("city_code", "")).strip(),
                    threshold_min=int(item.get("threshold_min", ALERT_THRESHOLD_MIN)),
                )
            )
        return targets

    region = os.getenv("BUS_REGION", "daejeon").strip().lower()
    stop_no = os.getenv("BUS_STOP_ARS_ID", "11690").replace("-", "").strip()
    stop_name = os.getenv(
        "BUS_STOP_NAME",
        "명석고등학교 (11690, 한국폴리텍대학·대전역·오월드 방면)"
        if stop_no == "11690"
        else f"정류소({stop_no})",
    ).strip()
    routes_raw = os.getenv("BUS_ROUTES", os.getenv("BUS_ROUTE_NO", "311"))
    routes = [r.strip() for r in routes_raw.split(",") if r.strip()]
    station_id = os.getenv("BUS_STOP_NODE_ID", "").strip()
    city_code = os.getenv("TAGO_CITY_CODE", "").strip()

    return [
        WatchTarget(
            region=region,
            stop_no=stop_no,
            routes=routes,
            stop_name=stop_name,
            station_id=station_id,
            city_code=city_code,
            threshold_min=ALERT_THRESHOLD_MIN,
        )
    ]


def parse_tago_response(resp_text: str) -> list[dict[str, Any]]:
    text = resp_text.strip()
    if not text:
        return []
    if text.startswith("{"):
        data = json.loads(text)
        body = data.get("response", {}).get("body", {})
        items = body.get("items")
        if not items:
            return []
        item_data = items.get("item", [])
        if isinstance(item_data, dict):
            return [item_data]
        if isinstance(item_data, list):
            return item_data
        return []

    root = ET.fromstring(text)
    err_msg = root.findtext(".//returnAuthMsg") or root.findtext(".//errMsg")
    result_msg = root.findtext(".//resultMsg")
    if err_msg and err_msg != "NORMAL_CODE":
        raise RuntimeError(f"공공데이터포털 API 인증/호출 오류: {err_msg} ({result_msg})")
    items_list: list[dict[str, Any]] = []
    for item_el in root.findall(".//item"):
        items_list.append({child.tag: (child.text or "") for child in item_el})
    return items_list


def resolve_tago_node_id(service_key: str, city_code: str, target: WatchTarget) -> str:
    if target.station_id:
        return target.station_id

    # 1차: 버스정류소정보 API(getSttnNoList) 조회
    try:
        params = {
            "serviceKey": service_key,
            "cityCode": city_code,
            "nodeNo": target.stop_no,
            "numOfRows": 30,
            "pageNo": 1,
            "_type": "json",
        }
        resp = requests.get(TAGO_STOP_SEARCH_URL, params=params, timeout=10)
        resp.raise_for_status()
        for item in parse_tago_response(resp.text):
            if str(item.get("nodeno", "")).strip() == target.stop_no:
                node_id = str(item.get("nodeid", "")).strip()
                if not target.stop_name:
                    target.stop_name = str(item.get("nodenm", target.stop_no)).strip()
                if node_id:
                    target.station_id = node_id
                    print(
                        f"[INFO][TAGO] 정류소 번호 {target.stop_no} -> nodeId {node_id} 매칭 완료"
                    )
                    return node_id
    except Exception as exc:
        print(f"[WARN] TAGO 정류소 번호 조회(BusSttnInfoInqireService) 실패: {exc}")

    # 2차: 대전 명석고등학교(11690 / 51630)일 경우 버스도착정보 API만 신청된 상태에서도 동작하도록 후보 nodeId 탐색
    if city_code == "25" and target.stop_no in ("11690", "51630"):
        if target.stop_no == "51630":
            target.station_id = "DJB8001611"
            return "DJB8001611"
        for candidate_id in ("DJB8001610", "DJB8001612", "DJB8001611"):
            try:
                probe_params = {
                    "serviceKey": service_key,
                    "cityCode": "25",
                    "nodeId": candidate_id,
                    "numOfRows": 30,
                    "pageNo": 1,
                    "_type": "json",
                }
                probe_resp = requests.get(
                    TAGO_ARRIVAL_ALL_URL, params=probe_params, timeout=10
                )
                probe_resp.raise_for_status()
                probe_items = parse_tago_response(probe_resp.text)
                if any("명석고" in str(it.get("nodenm", "")) for it in probe_items):
                    target.station_id = candidate_id
                    print(
                        f"[INFO][TAGO] 도착정보 API 직접 탐색으로 명석고({target.stop_no}) -> {candidate_id} 매칭 완료"
                    )
                    return candidate_id
            except Exception:
                continue
        # 심야/운행종료 시간대라 도착 예정 버스가 0대여서 probe_items가 비어있는 경우 기본값 지정
        target.station_id = "DJB8001610"
        print("[INFO][TAGO] 명석고(11690) 기본 표준 ID(DJB8001610) 사용")
        return "DJB8001610"

    raise RuntimeError(
        f"[TAGO] 도시코드 {city_code}에서 정류소 번호 {target.stop_no}의 nodeId를 찾지 못했습니다. "
        "공공데이터포털에서 '국토교통부_(TAGO)_버스정류소정보' 활용신청 여부를 확인해 주세요."
    )


def fetch_tago_arrivals(
    service_key: str, target: WatchTarget, city_code_override: str = ""
) -> list[UnifiedArrival]:
    city_code = (
        city_code_override
        or target.city_code
        or TAGO_CITY_CODES.get(target.region, "25")
    )
    node_id = resolve_tago_node_id(service_key, city_code, target)

    params = {
        "serviceKey": service_key,
        "cityCode": city_code,
        "nodeId": node_id,
        "numOfRows": 50,
        "pageNo": 1,
        "_type": "json",
    }
    resp = requests.get(TAGO_ARRIVAL_ALL_URL, params=params, timeout=10)
    resp.raise_for_status()
    items = parse_tago_response(resp.text)

    want_routes = {r.upper() for r in target.routes}
    results: list[UnifiedArrival] = []
    for it in items:
        route_no = str(it.get("routeno", "")).strip()
        if want_routes and route_no.upper() not in want_routes:
            continue
        if it.get("arrtime") is None:
            continue
        stop_nm = target.stop_name or str(it.get("nodenm", target.stop_no)).strip()
        
        # TAGO API에서 차량 번호가 제공되는 경우 대비
        veh_no = str(it.get("vehicleno", "")).strip()
        
        results.append(
            UnifiedArrival(
                region_label="대전/TAGO" if city_code == "25" else f"TAGO({city_code})",
                stop_name=stop_nm,
                stop_no=target.stop_no,
                route_no=route_no,
                arr_sec=int(it["arrtime"]),
                prev_station_cnt=str(it.get("arrprevstationcnt", "?")),
                vehicle_type=str(it.get("vehicletp", "일반버스")),
                vehicle_id_or_plate=veh_no,
                extra_info=f"노선유형: {it.get('routetp', '시내버스')}",
                raw_fields=it,
            )
        )
    results.sort(key=lambda x: x.arr_sec)
    return results


def extract_gbis_list(response_json: dict[str, Any], list_key: str) -> list[dict[str, Any]]:
    msg_body = response_json.get("response", {}).get("msgBody", {})
    if not msg_body:
        return []
    data = msg_body.get(list_key, [])
    if isinstance(data, dict):
        return [data]
    if isinstance(data, list):
        return data
    return []


def resolve_gbis_station_id(service_key: str, target: WatchTarget) -> str:
    if target.station_id:
        return target.station_id

    params = {
        "serviceKey": service_key,
        "keyword": target.stop_no,
        "format": "json",
    }
    resp = requests.get(GBIS_STATION_LIST_URL, params=params, timeout=10)
    resp.raise_for_status()
    stations = extract_gbis_list(resp.json(), "busStationList")

    for st in stations:
        mobile_no = str(st.get("mobileNo", "")).strip()
        if mobile_no == target.stop_no:
            station_id = str(st.get("stationId", "")).strip()
            region_nm = str(st.get("regionName", "경기")).strip()
            st_name = str(st.get("stationName", target.stop_no)).strip()
            if not target.stop_name:
                target.stop_name = f"{st_name} ({region_nm}, {target.stop_no})"
            if station_id:
                target.station_id = station_id
                print(
                    f"[INFO][성남/경기] 정류소 번호 {target.stop_no} -> stationId {station_id} ({st_name}) 매칭 완료"
                )
                return station_id

    raise RuntimeError(
        f"[성남/경기] 정류소 번호(mobileNo) '{target.stop_no}'에 해당하는 stationId를 찾지 못했습니다."
    )


def fetch_gbis_arrivals(service_key: str, target: WatchTarget) -> list[UnifiedArrival]:
    try:
        station_id = resolve_gbis_station_id(service_key, target)
        params = {
            "serviceKey": service_key,
            "stationId": station_id,
            "format": "json",
        }
        resp = requests.get(GBIS_ARRIVAL_LIST_URL, params=params, timeout=10)
        resp.raise_for_status()
        items = extract_gbis_list(resp.json(), "busArrivalList")

        want_routes = {r.upper() for r in target.routes}
        results: list[UnifiedArrival] = []
        low_plate_map = {
            "0": "일반버스",
            "1": "저상버스",
            "2": "2층버스",
            "7": "트롤리버스",
        }

        for it in items:
            route_nm = str(it.get("routeName", "")).strip()
            if want_routes and route_nm.upper() not in want_routes:
                continue

            pred_min_raw = it.get("predictTime1")
            if pred_min_raw is None or str(pred_min_raw).strip() == "":
                continue
            pred_min = int(pred_min_raw)
            arr_sec = pred_min * 60
            loc_no = str(it.get("locationNo1", "?")).strip()
            low_plate_code = str(it.get("lowPlate1", "0")).strip()
            veh_type = low_plate_map.get(low_plate_code, "일반버스")
            plate_no = str(it.get("plateNo1", "")).strip()
            dest_name = str(it.get("routeDestName", "")).strip()
            remain_seat = it.get("remainSeatCnt1")

            extra_parts: list[str] = []
            if dest_name:
                extra_parts.append(f"종점방향: {dest_name}")
            if remain_seat is not None and int(remain_seat) >= 0:
                extra_parts.append(f"잔여좌석: {remain_seat}석")
            if plate_no:
                extra_parts.append(f"차량번호: {plate_no}")

            results.append(
                UnifiedArrival(
                    region_label="성남/경기",
                    stop_name=target.stop_name or f"정류소({target.stop_no})",
                    stop_no=target.stop_no,
                    route_no=route_nm,
                    arr_sec=arr_sec,
                    prev_station_cnt=loc_no,
                    vehicle_type=veh_type,
                    vehicle_id_or_plate=plate_no,
                    extra_info=" | ".join(extra_parts),
                    raw_fields=it,
                )
            )

        results.sort(key=lambda x: x.arr_sec)
        return results
    except Exception as gbis_exc:
        if target.region == "seongnam":
            print(
                f"[WARN] 경기도 GBIS API 호출 실패, TAGO 성남시(31020) 코드로 폴백 시도: {gbis_exc}"
            )
            return fetch_tago_arrivals(
                service_key, target, city_code_override="31020"
            )
        raise


def parse_seoul_arrmsg_seconds(tra_time_raw: Any, arrmsg: str) -> tuple[int | None, str]:
    msg = (arrmsg or "").strip()
    if any(closed in msg for closed in ("운행종료", "출발대기", "차고지")):
        return None, "-"

    prev_cnt = "?"
    bracket_match = re.search(r"\[(\d+)번째\s*전\]", msg)
    if bracket_match:
        prev_cnt = bracket_match.group(1)

    if "곧도착" in msg:
        return 30, "0 (곧도착)"

    min_sec_match = re.search(r"(\d+)분\s*(?:(\d+)초)?", msg)
    if min_sec_match:
        mins = int(min_sec_match.group(1))
        secs = int(min_sec_match.group(2) or 0)
        return mins * 60 + secs, prev_cnt

    if tra_time_raw is not None and str(tra_time_raw).strip().isdigit():
        tra_sec = int(str(tra_time_raw).strip())
        if tra_sec > 0:
            return tra_sec, prev_cnt

    return None, prev_cnt


def fetch_seoul_arrivals(service_key: str, target: WatchTarget) -> list[UnifiedArrival]:
    params = {
        "serviceKey": service_key,
        "arsId": target.stop_no,
        "resultType": "json",
    }
    resp = requests.get(SEOUL_STATION_UID_URL, params=params, timeout=10)
    resp.raise_for_status()
    text_body = resp.text.strip()

    raw_items: list[dict[str, Any]] = []
    if text_body.startswith("{"):
        data = resp.json()
        item_list = data.get("msgBody", {}).get("itemList")
        if isinstance(item_list, dict):
            raw_items = [item_list]
        elif isinstance(item_list, list):
            raw_items = item_list
    else:
        root = ET.fromstring(text_body)
        for item_el in root.findall(".//itemList"):
            raw_items.append({child.tag: (child.text or "") for child in item_el})

    want_routes = {r.upper() for r in target.routes}
    results: list[UnifiedArrival] = []

    for it in raw_items:
        rt_nm = str(it.get("rtNm", "")).strip()
        abrv_nm = str(it.get("busRouteAbrv", "")).strip()
        matched_route = rt_nm or abrv_nm
        if want_routes and (
            rt_nm.upper() not in want_routes and abrv_nm.upper() not in want_routes
        ):
            continue

        arrmsg1 = str(it.get("arrmsg1", "")).strip()
        tra_time1 = it.get("traTime1")
        arr_sec, prev_cnt = parse_seoul_arrmsg_seconds(tra_time1, arrmsg1)
        if arr_sec is None:
            continue

        st_nm = str(it.get("stNm", target.stop_no)).strip()
        direction = str(it.get("adirection", "")).strip()
        plain_no1 = str(it.get("plainNo1", "")).strip()
        stop_label = (
            target.stop_name
            or f"{st_nm} ({direction} 방면, {target.stop_no})"
            if direction
            else f"{st_nm} ({target.stop_no})"
        )

        extra_parts = [f"현황: {arrmsg1}"]
        if direction:
            extra_parts.append(f"진행방향: {direction}")
        if plain_no1:
            extra_parts.append(f"차량번호: {plain_no1}")

        results.append(
            UnifiedArrival(
                region_label="서울",
                stop_name=stop_label,
                stop_no=target.stop_no,
                route_no=matched_route,
                arr_sec=arr_sec,
                prev_station_cnt=prev_cnt,
                vehicle_type="시내/광역버스",
                vehicle_id_or_plate=plain_no1 or str(it.get("vehId1", "")).strip(),
                extra_info=" | ".join(extra_parts),
                raw_fields=it,
            )
        )

    results.sort(key=lambda x: x.arr_sec)
    return results


def fetch_arrivals_for_target(
    service_key: str, target: WatchTarget
) -> list[UnifiedArrival]:
    reg = target.region.lower()
    if reg in ("seongnam", "gyeonggi", "성남", "경기"):
        return fetch_gbis_arrivals(service_key, target)
    if reg in ("seoul", "서울"):
        return fetch_seoul_arrivals(service_key, target)
    return fetch_tago_arrivals(service_key, target)


def generate_gemini_briefing(
    arrival: UnifiedArrival, threshold_min: int, now_kst: datetime.datetime
) -> str:
    arr_min = arrival.arr_sec // 60
    rem_sec = arrival.arr_sec % 60
    
    # 부가 정보와 차량 번호 조합 로직
    info_list = []
    if arrival.extra_info:
        info_list.append(arrival.extra_info)
    
    # extra_info 문자열 내에 '차량번호'가 이미 포함되어 있지 않은 경우에만 별도 추가
    if arrival.vehicle_id_or_plate and "차량번호" not in arrival.extra_info:
        info_list.append(f"차량번호: {arrival.vehicle_id_or_plate}")

    extra_info_str = f"\n💡 부가정보 : {' | '.join(info_list)}" if info_list else ""
    
    # 가독성 강조형 (구분선 활용) 텔레그램 메시지 포맷
    msg = (
        f"🚌 [{arrival.route_no}번 버스 도착 안내]\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"⏳ 남은시간 : {arr_min}분 {rem_sec}초 후\n"
        f"🚏 남은위치 : {arrival.prev_station_cnt}정류장 전\n"
        f"📍 정류소명 : {arrival.stop_name}\n"
        f"━━━━━━━━━━━━━━━━━━"
        f"{extra_info_str}"
    )
    
    return msg


def send_telegram_message(text: str) -> None:
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text,
    }
    resp = requests.post(url, json=payload, timeout=10)
    resp.raise_for_status()
    print("[INFO] 텔레그램 메시지 전송 완료")


def main() -> None:
    missing = [
        name
        for name, val in [
            ("DATA_GO_KR_API_KEY", DATA_GO_KR_API_KEY),
            ("TELEGRAM_BOT_TOKEN", TELEGRAM_BOT_TOKEN),
            ("TELEGRAM_CHAT_ID", TELEGRAM_CHAT_ID),
        ]
        if not val
    ]
    if missing:
        print(
            f"[ERROR] GitHub Secrets에 필수 환경변수가 등록되지 않았거나 비어 있습니다: {', '.join(missing)}\n"
            "저장소 상단 Settings -> Secrets and variables -> Actions 메뉴에서 시크릿 이름을 확인해 주세요."
        )
        sys.exit(1)

    targets = load_watch_targets()
    print(f"[INFO] 총 {len(targets)}개 정류장 감시 타겟 로드 완료:")
    for t in targets:
        print(
            f"  - 권역: {t.region} | 정류소번호: {t.stop_no} ({t.stop_name}) | "
            f"노선: {', '.join(t.routes)} | 알림기준: {t.threshold_min}분 전"
        )

    now_kst = datetime.datetime.now(KST)
    start_time = now_kst.replace(
        hour=WINDOW_START_HOUR, minute=WINDOW_START_MIN, second=0, microsecond=0
    )
    end_time = now_kst.replace(
        hour=WINDOW_END_HOUR, minute=WINDOW_END_MIN, second=0, microsecond=0
    )

    if RUN_ONCE_NOW:
        print(f"[INFO] 수동/즉시 1회 점검 모드 실행 ({now_kst.strftime('%Y-%m-%d %H:%M:%S')})")
        any_error = False
        for target in targets:
            try:
                arrivals = fetch_arrivals_for_target(DATA_GO_KR_API_KEY, target)
                if not arrivals:
                    send_telegram_message(
                        f"ℹ️ [{now_kst.strftime('%H:%M')}] [{target.region.upper()}] "
                        f"{target.stop_name or target.stop_no} 정류장에 현재 도착 예정인 "
                        f"{', '.join(target.routes)}번 버스가 없습니다. (연동 정상 확인 완료)"
                    )
                    continue
                seen_routes: set[str] = set()
                for arr in arrivals:
                    if arr.route_no in seen_routes:
                        continue
                    seen_routes.add(arr.route_no)
                    briefing = generate_gemini_briefing(
                        arr, target.threshold_min, now_kst
                    )
                    send_telegram_message(briefing)
            except Exception as exc:
                any_error = True
                print(f"[ERROR] 타겟({target.stop_no}) 조회 중 오류: {exc}")
        if any_error:
            sys.exit(1)
        return

    # 1) 아침 배치 시작 시간 이전에 크론이 일찍 켜졌으면 대기
    # 2) 만약 GitHub 크론 지연으로 늦게 켜졌다면 즉시 종료하지 않고 현재 시각부터 배치 지속 시간 동안 감시를 수행합니다.
    if now_kst < start_time:
        wait_sec = (start_time - now_kst).total_seconds()
        # 단, 조기 기상일 때만 대기하고, 그 외 시간대 수동 배치 실행은 즉시 시작
        if wait_sec <= 3600:
            print(
                f"[INFO] 아침 배치 시작 시각({start_time.strftime('%H:%M')})까지 {int(wait_sec)}초 대기합니다..."
            )
            time.sleep(max(0, wait_sec))
            now_kst = datetime.datetime.now(KST)
        else:
            end_time = now_kst + datetime.timedelta(minutes=BATCH_DURATION_MIN)
    elif now_kst >= end_time - datetime.timedelta(minutes=5):
        end_time = now_kst + datetime.timedelta(minutes=BATCH_DURATION_MIN)
        print(
            f"[INFO] 지정 시간대 이후 실행 감지 -> 지금부터 {BATCH_DURATION_MIN}분간({end_time.strftime('%H:%M')}까지) 배치 감시를 진행합니다."
        )

    print(
        f"[INFO] 배치 폴링 시작: {now_kst.strftime('%H:%M:%S')} ~ {end_time.strftime('%H:%M:%S')} KST "
        f"(조회 주기: {POLL_INTERVAL_SEC}초)"
    )

    last_notified_sec_map: dict[tuple[str, str, str], int] = {}
    last_notified_plate_map: dict[tuple[str, str, str], str] = {}
    is_first_poll = True

    while True:
        now_kst = datetime.datetime.now(KST)
        if now_kst > end_time:
            print(f"[INFO] 모니터링 종료 시각({end_time.strftime('%H:%M')}) 도달. 배치 작업을 마칩니다.")
            break

        for target in targets:
            threshold_sec = target.threshold_min * 60
            try:
                arrivals = fetch_arrivals_for_target(DATA_GO_KR_API_KEY, target)
                nearest_by_route: dict[str, UnifiedArrival] = {}
                for arr in arrivals:
                    if arr.route_no not in nearest_by_route:
                        nearest_by_route[arr.route_no] = arr

                # 배치 시작 첫 폴링 시 현재 운행 현황 요약 1회 전송
                if is_first_poll and SEND_START_SUMMARY and not nearest_by_route:
                    send_telegram_message(
                        f"🕖 [{now_kst.strftime('%H:%M')} 배치 감시 시작] "
                        f"{target.stop_name} ({', '.join(target.routes)}번) ~{end_time.strftime('%H:%M')}까지 "
                        f"도착 {target.threshold_min}분 전 진입 여부를 1분 간격으로 감시합니다."
                    )

                for route_no, nearest in nearest_by_route.items():
                    key = (target.region, target.stop_no, route_no)
                    print(
                        f"[{now_kst.strftime('%H:%M:%S')}][{nearest.region_label}] "
                        f"{nearest.stop_name} - {route_no}번: "
                        f"{nearest.arr_sec // 60}분 {nearest.arr_sec % 60}초 후 "
                        f"({nearest.prev_station_cnt}정류장 전)"
                    )

                    if nearest.arr_sec <= threshold_sec:
                        prev_sec = last_notified_sec_map.get(key)
                        prev_plate = last_notified_plate_map.get(key, "")

                        if nearest.vehicle_id_or_plate and prev_plate:
                            is_new_bus = nearest.vehicle_id_or_plate != prev_plate
                        else:
                            is_new_bus = prev_sec is None or nearest.arr_sec > (
                                prev_sec + 120
                            )

                        if is_new_bus:
                            briefing = generate_gemini_briefing(
                                nearest, target.threshold_min, now_kst
                            )
                            send_telegram_message(briefing)

                        last_notified_sec_map[key] = nearest.arr_sec
                        if nearest.vehicle_id_or_plate:
                            last_notified_plate_map[key] = nearest.vehicle_id_or_plate
                    elif is_first_poll and SEND_START_SUMMARY:
                        # 첫 폴링 시점 1회 안내
                        send_telegram_message(
                            f"🕖 [{now_kst.strftime('%H:%M')} 배치 감시 시작] "
                            f"현재 가장 가까운 {route_no}번 버스는 약 {nearest.arr_sec // 60}분 후"
                            f"({nearest.prev_station_cnt}정류장 전) 도착 예정입니다."
                        )
            except Exception as exc:
                print(
                    f"[WARN] 타겟({target.region}/{target.stop_no}) 폴링 중 일시적 오류: {exc}"
                )

        is_first_poll = False
        now_after = datetime.datetime.now(KST)
        if now_after + datetime.timedelta(seconds=POLL_INTERVAL_SEC) > end_time:
            print(f"[INFO] 배치 감시 종료 시각({end_time.strftime('%H:%M')}) 도달. 정상 종료합니다.")
            break
        time.sleep(POLL_INTERVAL_SEC)


if __name__ == "__main__":
    main()
