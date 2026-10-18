#!/usr/bin/env python3
"""
전국 통합(대전·성남/경기·서울) 다중 정류장·다중 버스 노선
도착 N분 전 제미나이(Gemini) 브리핑 & 텔레그램 자동 알림 스크립트 (GitHub Actions 전용)

지원 권역 및 공식 OpenAPI:
1. 대전 및 전국 지자체 (region="daejeon" 또는 "tago")
   - 국토교통부(TAGO) 버스도착정보: https://www.data.go.kr/data/15098530/openapi.do
   - 국토교통부(TAGO) 버스정류소정보: https://www.data.go.kr/data/15098534/openapi.do
   - 국토교통부(TAGO) 버스노선정보: https://www.data.go.kr/data/15098529/openapi.do
2. 성남시·경기도 전역 (region="seongnam" 또는 "gyeonggi")
   - 경기도_버스도착정보 조회(v2): https://www.data.go.kr/data/15080346/openapi.do
   - 경기도_정류소 조회(v2): https://www.data.go.kr/data/15080666/openapi.do
   - 경기버스정보(GBIS) 매뉴얼: https://www.gbis.go.kr/gbis2014/publicService.action?cmd=mBusArrivalStation
3. 서울특별시 전역 (region="seoul")
   - 서울특별시_버스도착정보조회: https://www.data.go.kr/data/15000314/openapi.do
   - 서울시 정류소정보조회(getStationByUid): http://api.bus.go.kr/contents/sub02/getStationByUid.html
4. AI 브리핑 & 텔레그램 알림
   - Google GenAI SDK (google-genai): https://ai.google.dev/gemini-api/docs/libraries
   - Telegram Bot API (sendMessage): https://core.telegram.org/bots/api
"""

from __future__ import annotations

import datetime
import json
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Any
from zoneinfo import ZoneInfo

import requests
from google import genai

KST = ZoneInfo("Asia/Seoul")

# =====================================================================
# 1. 환경변수 및 기본 타겟 설정 (단일 설정 & 다중 JSON 설정 모두 지원)
# =====================================================================
DATA_GO_KR_API_KEY = os.getenv("DATA_GO_KR_API_KEY", "").strip()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "").strip()

# 기본 알림 조건 및 모니터링 시간대 (기본값: 도착 5분 전 이내, 07:20 ~ 07:40 KST)
ALERT_THRESHOLD_MIN = int(os.getenv("ALERT_THRESHOLD_MIN", "5"))
POLL_INTERVAL_SEC = int(os.getenv("POLL_INTERVAL_SEC", "60"))
WINDOW_START_HOUR = int(os.getenv("WINDOW_START_HOUR", "7"))
WINDOW_START_MIN = int(os.getenv("WINDOW_START_MIN", "20"))
WINDOW_END_HOUR = int(os.getenv("WINDOW_END_HOUR", "7"))
WINDOW_END_MIN = int(os.getenv("WINDOW_END_MIN", "40"))
RUN_ONCE_NOW = os.getenv("RUN_ONCE_NOW", "false").lower() == "true"

# TAGO 주요 도시코드 매핑
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

# OpenAPI 엔드포인트 정의
TAGO_STOP_SEARCH_URL = (
    "http://apis.data.go.kr/1613000/BusSttnInfoInqireService/getSttnNoList"
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
    """감시할 정류장 및 버스 노선 설정 단위"""

    region: str  # 'daejeon' | 'seongnam' | 'gyeonggi' | 'seoul' | 'tago'
    stop_no: str  # 정류소 번호(5자리 ARS-ID / mobileNo, 예: '11690', '06019', '22009')
    routes: list[str]  # 감시할 노선번호 목록 (예: ['311', '103'] 또는 ['340', '9000'])
    stop_name: str = ""  # 정류장 별칭 (미입력 시 API 응답 정류소명 자동 사용)
    station_id: str = ""  # 표준 정류소 ID (미입력 시 stop_no로 자동 조회 및 캐싱)
    city_code: str = ""  # TAGO 전용 도시코드 (대전 기본값 '25', 성남 폴백 '31020')
    threshold_min: int = ALERT_THRESHOLD_MIN


@dataclass
class UnifiedArrival:
    """권역별(대전·성남/경기·서울) 버스 도착 정보를 통일한 표준 데이터 모델"""

    region_label: str
    stop_name: str
    stop_no: str
    route_no: str
    arr_sec: int  # 도착 예상 남은 시간 (초)
    prev_station_cnt: str  # 남은 정류장 수 (예: '3')
    vehicle_type: str = "일반버스"  # 일반버스 / 저상버스 / 2층버스 등
    vehicle_id_or_plate: str = ""  # 차량번호 또는 고유ID (중복 알림 방지용)
    extra_info: str = ""  # 빈자리 수(성남/경기 광역버스), 원문 메시지(서울), 방향 정보 등
    raw_fields: dict[str, Any] = field(default_factory=dict)


def load_watch_targets() -> list[WatchTarget]:
    """
    TARGETS_JSON 환경변수가 있으면 다중 정류장·다중 버스 목록을 로드하고,
    없으면 단일 환경변수(기본값: 대전 명석고등학교 11690 / 311번)를 로드합니다.
    """
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

    # 단일 환경변수 모드 (기존 호환 + 다중 노선 콤마 구분 지원)
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


# =====================================================================
# 2. 권역 1: 대전 및 전국 TAGO API 조회 모듈 (region="daejeon" | "tago")
# =====================================================================
def extract_tago_items(response_json: dict[str, Any]) -> list[dict[str, Any]]:
    body = response_json.get("response", {}).get("body", {})
    items = body.get("items")
    if not items:
        return []
    item_data = items.get("item", [])
    if isinstance(item_data, dict):
        return [item_data]
    if isinstance(item_data, list):
        return item_data
    return []


def resolve_tago_node_id(service_key: str, city_code: str, target: WatchTarget) -> str:
    if target.station_id:
        return target.station_id

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
    for item in extract_tago_items(resp.json()):
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

    raise RuntimeError(
        f"[TAGO] 도시코드 {city_code}에서 정류소 번호 {target.stop_no}의 nodeId를 찾지 못했습니다."
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
    items = extract_tago_items(resp.json())

    want_routes = {r.upper() for r in target.routes}
    results: list[UnifiedArrival] = []
    for it in items:
        route_no = str(it.get("routeno", "")).strip()
        if want_routes and route_no.upper() not in want_routes:
            continue
        if it.get("arrtime") is None:
            continue
        stop_nm = target.stop_name or str(it.get("nodenm", target.stop_no)).strip()
        results.append(
            UnifiedArrival(
                region_label="대전/TAGO" if city_code == "25" else f"TAGO({city_code})",
                stop_name=stop_nm,
                stop_no=target.stop_no,
                route_no=route_no,
                arr_sec=int(it["arrtime"]),
                prev_station_cnt=str(it.get("arrprevstationcnt", "?")),
                vehicle_type=str(it.get("vehicletp", "일반버스")),
                extra_info=f"노선유형: {it.get('routetp', '시내버스')}",
                raw_fields=it,
            )
        )
    results.sort(key=lambda x: x.arr_sec)
    return results


# =====================================================================
# 3. 권역 2: 성남시·경기도 GBIS API 조회 모듈 (region="seongnam" | "gyeonggi")
# =====================================================================
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
    """
    성남·경기도 5자리 정류소 번호(mobileNo, 예: 06019 등)로
    경기도 표준 9자리 stationId(예: 206000xxx)를 자동 조회합니다.
    """
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
    """성남시·경기도 정류소의 실시간 버스 도착정보를 조회합니다 (실패 시 TAGO 성남 코드 31020 폴백)."""
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


# =====================================================================
# 4. 권역 3: 서울특별시 TOPIS API 조회 모듈 (region="seoul")
# =====================================================================
def parse_seoul_arrmsg_seconds(tra_time_raw: Any, arrmsg: str) -> tuple[int | None, str]:
    """
    서울시 버스 도착메시지(arrmsg1, 예: '4분12초후[3번째 전]', '곧도착', '운행종료', '출발대기')와
    traTime1(초)에서 도착 남은 시간(초)과 남은 정류장 수를 추출합니다.
    """
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
    """
    서울시 정류소 고유번호(arsId, 5자리 예: '22009')로 getStationByUid를 호출해
    지정 노선의 실시간 도착정보를 조회합니다 (JSON 및 XML 응답 모두 호환).
    """
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
        # XML 응답 파싱
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


# =====================================================================
# 5. 통합 디스패처, 제미나이(Gemini) 브리핑 생성 및 텔레그램 발송
# =====================================================================
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
    now_str = now_kst.strftime("%H:%M:%S")

    fallback_msg = (
        f"🚌 [{arrival.region_label} · {arrival.route_no}번 도착 {arr_min}분 전 알림]\n"
        f"• 정류장: {arrival.stop_name}\n"
        f"• 도착 예정: 약 {arr_min}분 {rem_sec}초 후 ({arrival.prev_station_cnt}정류장 전)\n"
        f"• 차량/부가정보: {arrival.vehicle_type}"
        + (f" ({arrival.extra_info})" if arrival.extra_info else "")
        + "\n지금 정류장으로 이동하시면 바로 탑승하실 수 있습니다!"
    )

    if not GEMINI_API_KEY:
        return fallback_msg

    prompt = (
        "당신은 대전·성남(경기)·서울권 출퇴근 및 통학 버스 탑승을 돕는 실시간 AI 교통 비서입니다.\n"
        "아래 실시간 공공데이터 API 조회 결과를 바탕으로 텔레그램 알림 메시지를 작성해 주세요.\n\n"
        f"- 기준 시각: {now_str} (KST)\n"
        f"- 권역: {arrival.region_label}\n"
        f"- 정류장: {arrival.stop_name} (정류소번호: {arrival.stop_no})\n"
        f"- 노선 번호: {arrival.route_no}번 버스\n"
        f"- 남은 도착 시간: 약 {arr_min}분 {rem_sec}초 ({arrival.arr_sec}초)\n"
        f"- 남은 정류장 수: {arrival.prev_station_cnt}정류장 전\n"
        f"- 차량 유형: {arrival.vehicle_type}\n"
        f"- 부가 정보: {arrival.extra_info or '없음'}\n"
        f"- 설정 알림 기준: 도착 {threshold_min}분 전 이내 진입\n\n"
        "작성 규칙:\n"
        f"1. 첫 줄에 이모지와 함께 핵심 요약('[{arrival.region_label} {arrival.route_no}번 도착 임박] 약 X분 후 도착 (Y정류장 전)')을 적어 주세요.\n"
        "2. 정류장명, 남은 시간·정류장 수, 부가 정보(광역버스 잔여좌석, 저상버스 여부, 진행방향 등)를 포함해 3줄 이내로 간결하게 정리해 주세요.\n"
        "3. 지금 바로 출발해야 하는지 여부를 다정하고 간결한 한 문장으로 덧붙여 주세요."
    )

    try:
        client = genai.Client(api_key=GEMINI_API_KEY)
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        if response and response.text:
            return response.text.strip()
    except Exception as exc:
        print(f"[WARN] Gemini API 호출 실패, 기본 브리핑 포맷 사용: {exc}")

    return fallback_msg


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
        print(f"[ERROR] 필수 환경변수가 누락되었습니다: {', '.join(missing)}")
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

    # 수동 1회 점검 모드(RUN_ONCE_NOW=true): 모든 타겟 정류장·노선을 즉시 조회해 브리핑 발송
    if RUN_ONCE_NOW:
        print(f"[INFO] 수동 즉시 점검 모드 실행 ({now_kst.strftime('%Y-%m-%d %H:%M:%S')})")
        for target in targets:
            try:
                arrivals = fetch_arrivals_for_target(DATA_GO_KR_API_KEY, target)
                if not arrivals:
                    send_telegram_message(
                        f"ℹ️ [{now_kst.strftime('%H:%M')}] [{target.region.upper()}] "
                        f"{target.stop_name or target.stop_no} 정류장에 현재 도착 예정인 "
                        f"{', '.join(target.routes)}번 버스가 없습니다."
                    )
                    continue
                # 노선별로 가장 빨리 도착하는 버스 1대씩 브리핑
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
                print(f"[ERROR] 타겟({target.stop_no}) 조회 중 오류: {exc}")
        return

    # 07:20 이전에 워크플로우가 조기 시작된 경우 시작 시각까지 대기
    if now_kst < start_time:
        wait_sec = (start_time - now_kst).total_seconds()
        print(f"[INFO] 시작 시각({start_time.strftime('%H:%M')})까지 {int(wait_sec)}초 대기합니다...")
        time.sleep(max(0, wait_sec))

    # (권역, 정류소번호, 노선번호)별 중복 알림 방지 상태 기록
    last_notified_sec_map: dict[tuple[str, str, str], int] = {}
    last_notified_plate_map: dict[tuple[str, str, str], str] = {}

    while True:
        now_kst = datetime.datetime.now(KST)
        if now_kst > end_time:
            print(f"[INFO] 모니터링 종료 시각({end_time.strftime('%H:%M')}) 도달. 작업을 마칩니다.")
            break

        for target in targets:
            threshold_sec = target.threshold_min * 60
            try:
                arrivals = fetch_arrivals_for_target(DATA_GO_KR_API_KEY, target)
                # 각 노선별 최근접 차량 1대씩만 평가
                nearest_by_route: dict[str, UnifiedArrival] = {}
                for arr in arrivals:
                    if arr.route_no not in nearest_by_route:
                        nearest_by_route[arr.route_no] = arr

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

                        # 차량번호(성남/경기·서울)가 있으면 차량번호 변경 여부로 새 버스 판별,
                        # 차량번호가 없으면(대전/TAGO) 남은 시간이 120초 이상 늘어났는지로 새 버스 판별
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
            except Exception as exc:
                print(
                    f"[WARN] 타겟({target.region}/{target.stop_no}) 폴링 중 일시적 오류: {exc}"
                )

        now_after = datetime.datetime.now(KST)
        if now_after + datetime.timedelta(seconds=POLL_INTERVAL_SEC) > end_time:
            break
        time.sleep(POLL_INTERVAL_SEC)


if __name__ == "__main__":
    main()
