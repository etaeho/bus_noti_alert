#!/usr/bin/env bash
# 에뮬레이터에 APK 를 설치·실행해서 크래시 여부와 첫 화면을 확인한다.
# 결과: smoke/result (PASS|FAIL), smoke/logcat.txt, smoke/errors.txt, smoke/screen.png, smoke/ui.xml
set -u
APK="$1"
PKG=com.busnoti.alertapp
OUT=smoke
mkdir -p "$OUT"
echo FAIL > "$OUT/result"

adb wait-for-device
if ! adb install -r -g "$APK" > "$OUT/install.txt" 2>&1; then
  echo "=== 설치 실패 ==="; cat "$OUT/install.txt"; exit 0
fi

adb logcat -c
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 > /dev/null

# 실행 직후 PID 를 잡아 두고 40초간 살아 있는지 관찰
FIRST_PID=""
for i in $(seq 1 40); do
  P=$(adb shell pidof "$PKG" | tr -d '\r')
  if [ -n "$P" ] && [ -z "$FIRST_PID" ]; then FIRST_PID="$P"; fi
  sleep 1
done
PID=$(adb shell pidof "$PKG" | tr -d '\r')
adb exec-out screencap -p > "$OUT/screen.png" || true
adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1 && adb pull /sdcard/ui.xml "$OUT/ui.xml" > /dev/null 2>&1 || true
adb logcat -d > "$OUT/logcat.txt"

{
  echo "--- 앱 프로세스(${FIRST_PID:-?}) 로그 (W/E/F) ---"
  if [ -n "$FIRST_PID" ]; then
    awk -v pid="$FIRST_PID" '$3 == pid && ($5 == "W" || $5 == "E" || $5 == "F")' "$OUT/logcat.txt" | tail -150
  fi
  echo "--- 크래시 블록 ---"
  grep -n -A 40 -E "FATAL EXCEPTION|Fatal signal|Abort message" "$OUT/logcat.txt" | head -200
  echo "--- JS 로그 ---"
  grep -E "ReactNativeJS|ReactNative:|unknown:React|BUSALERT_FATAL" "$OUT/logcat.txt" | tail -60
  echo "--- ActivityManager (앱 관련) ---"
  grep -E "ActivityManager.*$PKG|ActivityTaskManager.*$PKG" "$OUT/logcat.txt" | tail -20
} > "$OUT/errors.txt"

echo "=== 프로세스 PID: ${PID:-없음(종료됨)} ==="
echo "=== 화면 텍스트 ==="
grep -oE 'text="[^"]+"' "$OUT/ui.xml" 2>/dev/null | head -40 || true
echo "=== 오류 로그 ==="
cat "$OUT/errors.txt"

if [ -n "$PID" ] && ! grep -q "FATAL EXCEPTION" "$OUT/logcat.txt" && ! grep -q "Fatal signal" "$OUT/logcat.txt" && ! grep -q "BUSALERT_FATAL" "$OUT/logcat.txt"; then
  echo PASS > "$OUT/result"
fi
echo "=== 결과: $(cat "$OUT/result") ==="
