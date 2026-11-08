import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { describeAlertRule, toPlainText } from '../core/format';
import type { BusAlarm } from '../core/types';
import type { OutgoingNotification } from '../core/decide';
import { appendLog, getSettings, getTelegramToken } from './storage';

export const CHANNEL_BUS = 'bus-arrival';
export const CHANNEL_RIDE = 'ride-alight';
export const CHANNEL_REMINDER = 'monitor-reminder';

/** 앱이 열려 있을 때도 배너/소리 표시 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function setupNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_BUS, {
    name: '버스 도착 알림',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 300, 200, 300],
    sound: 'default',
  });
  await Notifications.setNotificationChannelAsync(CHANNEL_RIDE, {
    name: '하차 알림',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 600, 300, 600, 300, 600],
    sound: 'default',
  });
  await Notifications.setNotificationChannelAsync(CHANNEL_REMINDER, {
    name: '감시 시작 안내',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export async function ensureNotificationPermission(): Promise<boolean> {
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

async function sendTelegram(text: string): Promise<void> {
  const settings = await getSettings();
  if (!settings.telegramEnabled || !settings.telegramChatId) return;
  const token = await getTelegramToken();
  if (!token) return;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: settings.telegramChatId, text }),
    });
    if (!resp.ok) await appendLog(`텔레그램 전송 실패: HTTP ${resp.status}`);
  } catch (e) {
    await appendLog(`텔레그램 전송 실패: ${(e as Error).message}`);
  }
}

export async function deliver(n: OutgoingNotification, channelId = CHANNEL_BUS): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: n.key.replace(/[^a-zA-Z0-9:_-]/g, '_'),
    content: {
      title: n.title,
      body: n.body,
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.MAX,
      data: { key: n.key },
    },
    trigger: Platform.OS === 'android' ? { channelId } : null,
  });
  await sendTelegram(toPlainText(n));
}

/**
 * 감시 시작 시각마다 "버스 감시 시작" 안내를 OS 예약 알림으로 걸어 둔다.
 * 백그라운드 실행이 OS 에 의해 멈춰 있어도, 사용자가 이 알림을 누르면 앱이 열리며 감시가 재개된다.
 */
export async function rescheduleReminders(alarms: BusAlarm[]): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((s) => s.identifier.startsWith('reminder_'))
      .map((s) => Notifications.cancelScheduledNotificationAsync(s.identifier)),
  );
  if (!(await getSettings()).startReminderEnabled) return;
  for (const a of alarms) {
    if (!a.enabled) continue;
    const days = a.days.length ? a.days : [0, 1, 2, 3, 4, 5, 6];
    for (const d of days) {
      await Notifications.scheduleNotificationAsync({
        identifier: `reminder_${a.id}_${d}`,
        content: {
          title: `🕖 ${a.label || '버스 알림'} 감시 시간입니다`,
          body: `${a.stopName || a.stopNo} · ${a.routes.join(', ') || '전체'}번 — ${describeAlertRule(a)}에 알려드립니다.`,
          data: { alarmId: a.id, reminder: true },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: d + 1, // expo: 1=일요일
          hour: a.windowStart.hour,
          minute: a.windowStart.minute,
          ...(Platform.OS === 'android' ? { channelId: CHANNEL_REMINDER } : {}),
        },
      });
    }
  }
}
