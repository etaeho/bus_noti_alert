/**
 * 백그라운드 실행 구성
 *
 * 1) 위치 업데이트 태스크 (주 엔진)
 *    - Android: 포그라운드 서비스("버스 알림 감시 중" 상시 알림)로 앱이 꺼져도 30초마다 깨어남
 *    - iOS: 백그라운드 위치 모드로 실행 유지
 *    위치가 들어올 때마다 감시 틱을 실행하고, 하차 알림이 켜져 있으면 거리도 계산한다.
 * 2) 지오펜스 태스크: 하차 정류장 반경 진입 시 OS 가 직접 깨워줌 (가장 확실한 하차 알림)
 * 3) BackgroundTask (최소 15분): 위 둘이 OS 에 의해 중단됐을 때의 보조 수단
 *
 * 이 파일은 앱 진입점(index.ts)에서 가장 먼저 import 되어야 한다 (TaskManager.defineTask 는 전역 스코프 필수).
 */
import * as BackgroundTask from 'expo-background-task';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { runMonitorTick } from './monitor';
import { getAlarms, getRide, getServiceMode, setServiceMode } from './storage';

export const LOCATION_TASK = 'bus-alert-location-task';
export const GEOFENCE_TASK = 'bus-alert-geofence-task';
export const BG_TASK = 'bus-alert-background-task';

type ServiceMode = 'off' | 'watch' | 'ride';

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const locs = data?.locations ?? [];
  const last = locs[locs.length - 1];
  await runMonitorTick({ source: 'location', location: last ? last.coords : null });
  await ensureMonitoring({ allowStart: false });
});

TaskManager.defineTask<{ eventType: Location.GeofencingEventType; region: Location.LocationRegion }>(
  GEOFENCE_TASK,
  async ({ data, error }) => {
    if (error || !data) return;
    if (data.eventType === Location.GeofencingEventType.Enter) {
      await runMonitorTick({ source: 'geofence', forceRideArrived: true });
      await ensureMonitoring({ allowStart: false });
    }
  },
);

TaskManager.defineTask(BG_TASK, async () => {
  try {
    await runMonitorTick({ source: 'background' });
    await ensureMonitoring({ allowStart: false });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

async function desiredMode(): Promise<ServiceMode> {
  const ride = await getRide();
  if (ride?.active) return 'ride';
  const alarms = await getAlarms();
  return alarms.some((a) => a.enabled) ? 'watch' : 'off';
}

function locationOptions(mode: Exclude<ServiceMode, 'off'>): Location.LocationTaskOptions {
  const ride = mode === 'ride';
  return {
    accuracy: ride ? Location.Accuracy.High : Location.Accuracy.Balanced,
    timeInterval: ride ? 10_000 : 30_000,
    distanceInterval: ride ? 10 : 0,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    activityType: ride ? Location.ActivityType.AutomotiveNavigation : Location.ActivityType.Other,
    foregroundService: {
      notificationTitle: ride ? '🚏 하차 알림 진행 중' : '🚌 버스 알림 감시 중',
      notificationBody: ride
        ? '내릴 정류장에 가까워지면 알려드립니다.'
        : '설정한 시간대에 버스 도착 정보를 확인합니다.',
      notificationColor: '#1E6FD9',
      killServiceOnDestroy: false,
    },
  };
}

export interface MonitoringStatus {
  mode: ServiceMode;
  running: boolean;
  notice?: string;
}

/**
 * 현재 설정(알림/하차)에 맞게 백그라운드 서비스를 켜고/끄고/재구성한다.
 * Android 는 백그라운드에서 포그라운드 서비스를 새로 시작할 수 없으므로
 * 백그라운드 호출(allowStart=false)에서는 "끄기"만 수행한다.
 */
export async function ensureMonitoring({ allowStart }: { allowStart: boolean }): Promise<MonitoringStatus> {
  const mode = await desiredMode();
  let started = false;
  try {
    started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    started = false;
  }
  const currentMode = (await getServiceMode()) as ServiceMode;

  // 하차 지오펜스 동기화
  await syncGeofence(allowStart);

  if (mode === 'off') {
    if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
    await setServiceMode('off');
    return { mode, running: false };
  }

  if (started && currentMode === mode) return { mode, running: true };
  if (!allowStart) {
    // 하차 모드 → 감시 모드 다운그레이드는 다음에 앱이 열릴 때 적용
    return { mode, running: started };
  }

  const fg = await Location.getForegroundPermissionsAsync();
  const bg = await Location.getBackgroundPermissionsAsync();
  if (!fg.granted || !bg.granted) {
    return {
      mode,
      running: false,
      notice: '백그라운드 위치 권한("항상 허용")이 없어 앱이 열려 있을 때만 감시합니다.',
    };
  }

  if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
  await Location.startLocationUpdatesAsync(LOCATION_TASK, locationOptions(mode));
  await setServiceMode(mode);
  return { mode, running: true };
}

async function syncGeofence(allowStart: boolean): Promise<void> {
  const ride = await getRide();
  let started = false;
  try {
    started = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
  } catch {
    started = false;
  }
  if (!ride?.active) {
    if (started) await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => {});
    return;
  }
  if (!allowStart) return;
  const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
  if (!bg?.granted) return;
  // startGeofencingAsync 는 기존 영역을 교체한다
  await Location.startGeofencingAsync(GEOFENCE_TASK, [
    {
      identifier: 'ride-destination',
      latitude: ride.latitude,
      longitude: ride.longitude,
      // OS 지오펜스는 너무 작은 반경을 잘 감지하지 못하므로 최소 100m
      radius: Math.max(100, ride.radiusM),
      notifyOnEnter: true,
      notifyOnExit: false,
    },
  ]).catch(() => {});
}

export async function registerBackgroundTask(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (!(await TaskManager.isTaskRegisteredAsync(BG_TASK))) {
      await BackgroundTask.registerTaskAsync(BG_TASK, { minimumInterval: 15 });
    }
  } catch {
    // 시뮬레이터 등에서 미지원
  }
}

export async function requestLocationPermissions(): Promise<{ foreground: boolean; background: boolean }> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return { foreground: false, background: false };
  const bg = await Location.requestBackgroundPermissionsAsync();
  return { foreground: true, background: bg.granted };
}
