/**
 * 즐겨찾기 토글 + 이름 붙이기 대화상자
 */
import { useCallback, useEffect, useState } from 'react';

import type { StopCandidate } from '../core/types';
import { addFavorite, getFavorites, removeFavorite, stopKeyOf } from '../services/storage';
import { NamePrompt } from './NamePrompt';

export function useFavorites() {
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<{ stop: StopCandidate; dir: string } | null>(null);

  const refresh = useCallback(async () => {
    setKeys(new Set((await getFavorites()).map((f) => f.key)));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isFav = useCallback((s: StopCandidate) => keys.has(stopKeyOf(s)), [keys]);

  /** 즐겨찾기면 해제, 아니면 이름 입력 후 추가 */
  const toggle = useCallback(
    async (stop: StopCandidate, dir: string) => {
      const k = stopKeyOf(stop);
      if (keys.has(k)) {
        await removeFavorite(k);
        await refresh();
      } else {
        setPending({ stop, dir });
      }
    },
    [keys, refresh],
  );

  const prompt = (
    <NamePrompt
      visible={!!pending}
      title="⭐ 즐겨찾기 이름"
      message={pending ? `${pending.stop.stopName}${pending.dir ? `\n→ ${pending.dir}` : ''}\n\n비워 두면 정류장 이름으로 저장됩니다.` : ''}
      placeholder={pending?.stop.stopName}
      suggestions={['집 앞', '회사', '학교', '출근길', '퇴근길']}
      onCancel={() => setPending(null)}
      onSubmit={async (name) => {
        if (!pending) return;
        await addFavorite(pending.stop, pending.dir, name);
        setPending(null);
        await refresh();
      }}
    />
  );

  return { keys, isFav, toggle, prompt, refresh };
}
