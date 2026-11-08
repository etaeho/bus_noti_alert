import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useCallback, useEffect, useState } from 'react';

import { useTheme } from '../../components/ui';
import { getHistory, getHistorySeenAt } from '../../services/storage';

/** 아직 확인하지 않은 알림 개수 (알림 기록 탭 배지) */
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

export default function TabsLayout() {
  const t = useTheme();
  const unseen = useUnseenCount();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.card },
        headerTintColor: t.text,
        headerTitleStyle: { fontWeight: '800' },
        headerShadowVisible: false,
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.sub,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '정류장',
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Ionicons name="location" color={String(color)} size={size} />,
        }}
      />
      <Tabs.Screen
        name="alarms"
        options={{
          title: '내 알림',
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Ionicons name="bus" color={String(color)} size={size} />,
        }}
      />
      <Tabs.Screen
        name="ride"
        options={{
          title: '하차',
          headerTitle: '하차 알림',
          tabBarIcon: ({ color, size }) => <Ionicons name="flag" color={String(color)} size={size} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: '기록',
          headerTitle: '알림 기록',
          tabBarBadge: unseen > 0 ? (unseen > 99 ? '99+' : unseen) : undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name="notifications" color={String(color)} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '설정',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-sharp" color={String(color)} size={size} />,
        }}
      />
    </Tabs>
  );
}
