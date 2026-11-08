import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useCallback, useEffect, useState } from 'react';

import { useTheme, type IconName } from '../../components/ui';
import { getHistory, getHistorySeenAt } from '../../services/storage';

/** 아직 확인하지 않은 알림 개수 (기록 탭 배지) */
function useUnseenCount(): number {
  const [n, setN] = useState(0);
  const refresh = useCallback(async () => {
    const [list, seen] = await Promise.all([getHistory(), getHistorySeenAt()]);
    setN(list.filter((e) => e.at > seen).length);
  }, []);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  useEffect(() => {
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [refresh]);
  return n;
}

const icon =
  (on: IconName, off: IconName) =>
  ({ color, size, focused }: { color: unknown; size: number; focused: boolean }) => (
    <Ionicons name={focused ? on : off} color={String(color)} size={size} />
  );

export default function TabsLayout() {
  const t = useTheme();
  const unseen = useUnseenCount();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.sub,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border, height: 64, paddingTop: 6, paddingBottom: 8 },
        tabBarLabelStyle: { fontSize: 11.5, fontWeight: '800' },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: '정류장', tabBarIcon: icon('location', 'location-outline') }} />
      <Tabs.Screen name="alarms" options={{ title: '내 알림', tabBarIcon: icon('alarm', 'alarm-outline') }} />
      <Tabs.Screen name="ride" options={{ title: '하차', tabBarIcon: icon('flag', 'flag-outline') }} />
      <Tabs.Screen
        name="history"
        options={{
          title: '기록',
          tabBarBadge: unseen > 0 ? (unseen > 99 ? '99+' : unseen) : undefined,
          tabBarIcon: icon('notifications', 'notifications-outline'),
        }}
      />
      <Tabs.Screen name="settings" options={{ title: '설정', tabBarIcon: icon('settings', 'settings-outline') }} />
    </Tabs>
  );
}
