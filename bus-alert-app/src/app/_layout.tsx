import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { useTheme } from '../components/ui';
import { useMonitorRuntime } from '../services/runtime';

export default function RootLayout() {
  useMonitorRuntime();
  const t = useTheme();
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.card },
          headerTintColor: t.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: t.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: '버스 알리미' }} />
        <Stack.Screen name="alarm/[id]" options={{ title: '버스 알림 설정' }} />
        <Stack.Screen name="ride" options={{ title: '하차 알림' }} />
        <Stack.Screen name="settings" options={{ title: '설정' }} />
      </Stack>
    </>
  );
}
