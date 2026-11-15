import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { getHistory, getHistorySeenAt } from './storage';

/** 아직 확인하지 않은 알림 개수 (알림 탭 배지) */
export function useUnseenCount(): number {
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

