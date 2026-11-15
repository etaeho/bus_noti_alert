# 메모: 지도 API 요금 조사 (2026-11-08)

버스 알리미 앱에 Google 지도를 넣을 때 비용이 얼마나 드는지 조사한 내용입니다.
요금 정책은 자주 바뀌므로 **키 발급 전에 공식 요금표를 다시 확인**하세요.

## 결론
- **Maps SDK for Android의 지도 표시는 무제한 무료**입니다(Google 공식 문서 기준). 사용자가 많아져도 지도 화면 때문에 과금되지 않습니다.
- 이 앱은 정류장 검색, 주소 변환, 경로에 Google 유료 API(Places, Geocoding, Directions)를 **쓰지 않고**, 공공데이터포털 API를 씁니다. 그래서 Google 비용은 사실상 0원입니다.

## Google Maps Platform
| 항목 | 내용 |
| --- | --- |
| Maps SDK for Android (모바일 지도 표시) | 무제한 무료 |
| Dynamic Maps (웹 지도 로드) | 월 10,000회 무료, 이후 1,000회당 약 $7 |
| Places / Geocoding / Directions 등 | 별도 과금 (이 앱은 미사용) |
| 키 발급 | 결제 계정(카드) 등록 필요 |

- 2025년 3월 이후 "월 $200 크레딧" 방식에서 **SKU별 무료 사용량** 방식으로 바뀌었습니다. "$200 크레딧"이라고 적힌 자료는 예전 정보입니다.
- 검색 결과 중 일부는 Dynamic Maps SKU가 네이티브 Android에도 해당하는지 표현이 엇갈렸습니다. 적용 전에 Cloud Console의 결제 보고서로 실제 과금 SKU를 한 번 확인하세요.

### 키 보안 설정 (필수)
- API 제한: **Maps SDK for Android만** 허용
- 애플리케이션 제한: Android 앱
  - 패키지: `com.busnoti.alertapp`
  - SHA-1: `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` (Expo 기본 debug 키스토어. 스토어 배포용 키로 바꾸면 SHA-1도 교체)
- Cloud Console에서 **예산 알림**(예: $1)을 걸어 두면 예상 밖의 과금을 바로 알 수 있습니다.

### 앱 적용 방법
GitHub 저장소 Settings → Secrets and variables → Actions에 `GOOGLE_MAPS_API_KEY`를 등록하면 다음 빌드부터 Google 지도가 적용됩니다. 키는 코드에 남지 않습니다. 키가 없으면 무료 기본 지도(OpenStreetMap/CARTO)를 씁니다.

## 카카오맵 (참고)
- 앱별 무료 쿼터가 있고, 넘으면 429 오류가 나거나 유료 API로 건당 과금됩니다.
- 2026-07-21 이후 새로 만든 앱은 무료 쿼터 정책이 바뀌었습니다(세부 수치는 확인 못 함). 앱 관리 → [통계] → [쿼터]에서 직접 확인하세요.
- 2026-02-02 ~ 12-31에 80% 할인가(건당 10원)가 안내되어 있고, 정상가는 건당 50원으로 바뀔 수 있습니다.

## 출처
- https://developers.google.com/maps/documentation/android-sdk/usage-and-billing
- https://developers.google.com/maps/billing-and-pricing/pricing
- https://www.woosmap.com/blog/is-google-maps-api-free
- https://9to5google.com/2024/12/09/google-maps-platform-usage-limits/
- https://developers.kakao.com/docs/latest/ko/kakaomap/common
- https://developers.kakao.com/docs/ko/getting-started/quota
- https://www.kakaocorp.com/page/detail/8159
