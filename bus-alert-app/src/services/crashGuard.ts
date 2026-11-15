/**
 * 치명적인 JS 오류가 나도 앱이 바로 꺼지지 않고 오류 내용을 보여 준다.
 * (폰에서 테스트하면서 캡처해 전달하기 쉽도록) 앱 진입점에서 가장 먼저 import 한다.
 */
import { Alert } from 'react-native';

type Handler = (error: unknown, isFatal?: boolean) => void;
interface ErrorUtilsLike {
  getGlobalHandler(): Handler;
  setGlobalHandler(h: Handler): void;
}

const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;

if (errorUtils) {
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    const err = error as { message?: string; stack?: string } | undefined;
    // 에뮬레이터 실행 검사가 이 표식을 찾아 실패로 판정한다
    console.error('BUSALERT_FATAL', isFatal ? 'fatal' : 'non-fatal', err?.message, err?.stack);
    if (!isFatal) {
      previous(error, isFatal);
      return;
    }
    try {
      Alert.alert(
        '앱 오류가 발생했습니다',
        `${err?.message ?? String(error)}\n\n${(err?.stack ?? '').split('\n').slice(0, 6).join('\n')}\n\n이 화면을 캡처해서 알려 주세요.`,
      );
    } catch {
      previous(error, isFatal);
    }
  });
}
