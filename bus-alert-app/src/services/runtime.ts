import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { ensureMonitoring, registerBackgroundTask, type MonitoringStatus } from './background';
import { runMonitorTick } from './monitor';
import { ensureNotificationPermission, rescheduleReminders, setupNotificationChannels } from './notify';
import { getAlarms } from './storage';

type Listener = (s: MonitoringStatus) => void;
const listeners = new Set<Listener>();
let lastStatus: MonitoringStatus = { mode: 'off', running: false };

/** 알림/하차 설정이 바뀐 뒤 반드시 호출: 서비스 재구성 + 예약 안내 알림 갱신 + 즉시 1틱 */
export async function applyMonitoringChanges(): Promise<MonitoringStatus> {
  const status = await ensureMonitoring({ allowStart: true });
  lastStatus = status;
  listeners.forEach((l) => l(status));
  await rescheduleReminders(await getAlarms()).catch(() => {});
  void runMonitorTick({ source: 'foreground' });
  return status;
}

export function useMonitoringStatus(): MonitoringStatus {
  const [s, setS] = useState(lastStatus);
  useEffect(() => {
    listeners.add(setS);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}

/** 루트 레이아웃에서 1회 사용: 초기화 + 앱이 열려 있는 동안 10초마다 감시 틱 */
export function useMonitorRuntime(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    (async () => {
      await setupNotificationChannels().catch(() => {});
      await ensureNotificationPermission().catch(() => false);
      await registerBackgroundTask();
      await applyMonitoringChanges().catch(() => {});
    })();
    const start = () => {
      if (!timer) timer = setInterval(() => void runMonitorTick({ source: 'foreground' }), 10_000);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    start();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        start();
        void applyMonitoringChanges().catch(() => {});
      } else {
        stop();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, []);
}
