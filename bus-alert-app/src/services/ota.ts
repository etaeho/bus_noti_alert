/**
 * EAS Update (OTA) - 코드 수정 후 GitHub 에 푸시하면 CI 가 업데이트를 배포하고,
 * 앱은 열릴 때/화면으로 돌아올 때 확인해서 바로 적용할 수 있다.
 */
import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';

export type OtaResult = 'disabled' | 'none' | 'downloaded' | 'error';

let checking = false;

export async function checkAndFetchUpdate(): Promise<OtaResult> {
  if (__DEV__ || !Updates.isEnabled) return 'disabled';
  if (checking) return 'none';
  checking = true;
  try {
    const res = await Updates.checkForUpdateAsync();
    if (!res.isAvailable) return 'none';
    const fetched = await Updates.fetchUpdateAsync();
    return fetched.isNew ? 'downloaded' : 'none';
  } catch {
    return 'error';
  } finally {
    checking = false;
  }
}

export function applyUpdateNow(): Promise<void> {
  return Updates.reloadAsync();
}

export function describeCurrentBuild(): string {
  if (!Updates.isEnabled) return '업데이트 비활성 (개발 모드)';
  const id = Updates.updateId ? Updates.updateId.slice(0, 8) : '내장 번들';
  const at = Updates.createdAt ? Updates.createdAt.toLocaleString('ko-KR', { hour12: false }) : '';
  return `채널 ${Updates.channel ?? '-'} · 버전 ${id}${at ? ` (${at})` : ''}`;
}

function promptApply() {
  Alert.alert('새 버전이 있습니다', '방금 배포된 수정 사항을 지금 적용할까요?', [
    { text: '나중에', style: 'cancel' },
    { text: '지금 적용', onPress: () => void applyUpdateNow() },
  ]);
}

/** 루트 레이아웃에서 사용: 실행 시·포그라운드 복귀 시 새 업데이트 확인 */
export function useOtaUpdates(): void {
  useEffect(() => {
    const run = async () => {
      if ((await checkAndFetchUpdate()) === 'downloaded') promptApply();
    };
    void run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void run();
    });
    return () => sub.remove();
  }, []);
}
