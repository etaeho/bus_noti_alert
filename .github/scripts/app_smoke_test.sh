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
sleep 40

PID=$(adb shell pidof "$PKG" | tr -d '\r')
adb exec-out screencap -p > "$OUT/screen.png" || true
adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1 && adb pull /sdcard/ui.xml "$OUT/ui.xml" > /dev/null 2>&1 || true
adb logcat -d > "$OUT/logcat.txt"

grep -nE "FATAL EXCEPTION|AndroidRuntime|ReactNativeJS|ReactNative|Expo|DEBUG   :|libc  |Abort message|Exception|Error" "$OUT/logcat.txt" \
  | grep -vE "ResourcesManager|chatty|GoogleApiManager|Finsky|GmsClient" | tail -250 > "$OUT/errors.txt"

echo "=== 프로세스 PID: ${PID:-없음(종료됨)} ==="
echo "=== 화면 텍스트 ==="
grep -oE 'text="[^"]+"' "$OUT/ui.xml" 2>/dev/null | head -40 || true
echo "=== 오류 로그 ==="
cat "$OUT/errors.txt"

if [ -n "$PID" ] && ! grep -q "FATAL EXCEPTION" "$OUT/logcat.txt" && ! grep -q "Fatal signal" "$OUT/logcat.txt"; then
  echo PASS > "$OUT/result"
fi
echo "=== 결과: $(cat "$OUT/result") ==="
