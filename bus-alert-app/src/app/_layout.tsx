import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { useTheme } from '../components/ui';
import { useMonitorRuntime } from '../services/runtime';

export default function RootLayout() {
  useMonitorRuntime();
  const t = useTheme();
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.heroBg },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: { fontWeight: '800' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: t.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="alarm/[id]" options={{ title: '버스 알림 설정' }} />
        <Stack.Screen name="stop-picker" options={{ title: '정류장 선택' }} />
        <Stack.Screen name="stop/view" options={{ title: '정류장' }} />
      </Stack>
    </>
  );
}
