/**
 * 정류장 탭 (첫 화면)
 *  1) 즐겨찾기 정류장: 이름 · 정류장명 · 방면 + 곧 오는 버스
 *  2) 가까운 정류장 (현재 위치 기준, 가까운 순) → ☆ 로 이름 붙여 즐겨찾기
 *  3) 최근 본 정류장
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { HeroHeader } from '../../components/HeroHeader';
import { LiveArrivals } from '../../components/LiveArrivals';
import { NamePrompt } from '../../components/NamePrompt';
import { Button, Card, EmptyState, Icon, Muted, SectionTitle, useTheme } from '../../components/ui';
import { useFavorites } from '../../components/useFavorites';
import { REGION_LABELS, type StopCandidate } from '../../core/types';
import { resolveDirection } from '../../services/directionCache';
import { openStopDetail } from '../../services/stopNav';
import {
  getApiKey,
  getFavorites,
  getRecentStops,
  isStaleDirection,
  moveFavorite,
  removeFavorite,
  renameFavorite,
  stopKeyOf,
  type FavoriteStop,
} from '../../services/storage';
import { useNearbyStops, type DirState } from '../../services/useNearbyStops';

function formatDist(m?: number): string {
  if (m === undefined) return '';
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
}

function dirText(d: DirState | undefined): { text: string; muted: boolean } {
  if (d === undefined || d === 'loading') return { text: '방면 확인 중…', muted: true };
  if (d === 'error') return { text: '', muted: true };
  if (d.label) return { text: `→ ${d.label}`, muted: false };
  // 방면을 모르면 지나는 노선만
  return { text: d.routes.length ? `${d.routes.slice(0, 8).join(' · ')}번` : '', muted: true };
}

export default function StopsScreen() {
  const t = useTheme();
  const [favorites, setFavorites] = useState<FavoriteStop[]>([]);
  const [recent, setRecent] = useState<FavoriteStop[]>([]);
  const [hasKey, setHasKey] = useState(true);
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState<FavoriteStop | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const fav = useFavorites();
  const nearby = useNearbyStops(6);

  const load = useCallback(async () => {
    const [f, r, k] = await Promise.all([getFavorites(), getRecentStops(), getApiKey()]);
    setFavorites(f);
    setRecent(r.filter((x) => !f.some((y) => y.key === x.key)).slice(0, 5));
    setHasKey(!!k);
    await fav.refresh();
  }, [fav]);

  useFocusEffect(
    useCallback(() => {
      void load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  useEffect(() => {
    void nearby.load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 즐겨찾기 추가/해제 후 목록 갱신
  useEffect(() => {
    void getFavorites().then(setFavorites);
  }, [fav.keys]);

  // 예전 버전이 저장한 추정 방면(예: "서쪽 방향 (위치로 추정)")은 실제 방면으로 다시 확인
  const refreshing$ = useRef(false);
  useEffect(() => {
    const stale = favorites.filter((f) => isStaleDirection(f.directionLabel));
    if (!stale.length || refreshing$.current || !hasKey) return;
    refreshing$.current = true;
    void (async () => {
      for (const f of stale) {
        try {
          await resolveDirection(f.stop);
        } catch {
          // 다음 기회에
        }
      }
      setFavorites(await getFavorites());
      refreshing$.current = false;
    })();
  }, [favorites, hasKey]);

  const remove = (f: FavoriteStop) =>
    Alert.alert('즐겨찾기 삭제', `${f.nickname || f.stop.stopName}을(를) 즐겨찾기에서 뺄까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          await removeFavorite(f.key);
          await load();
        },
      },
    ]);

  const toggleNearbyFav = (s: StopCandidate) => {
    const d = nearby.directions[stopKeyOf(s)];
    void fav.toggle(s, d && typeof d === 'object' ? d.label : '');
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              await nearby.load(false);
              setRefreshKey((k) => k + 1);
              setRefreshing(false);
            }}
          />
        }
      >
        <HeroHeader title="정류장" subtitle="실시간 버스 도착 정보">
          <Pressable
            onPress={() => router.push({ pathname: '/stop-picker', params: { purpose: 'view', focus: '1' } })}
            style={styles.search}
            accessibilityRole="search"
          >
            <Icon name="search" size={20} color="#64748B" />
            <Text style={{ color: '#64748B', fontSize: 16, marginLeft: 10, flex: 1 }}>정류장 이름 검색 (예: 명석고)</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push({ pathname: '/stop-picker', params: { purpose: 'view' } })}
            style={styles.quickBtn}
          >
            <Icon name="map" size={16} color="#fff" />
            <Text style={styles.quickText}>지도에서 정류장 찾기</Text>
          </Pressable>
        </HeroHeader>

        <View style={styles.body}>
          {!hasKey ? (
            <Card onPress={() => router.push('/settings')} style={{ borderLeftWidth: 4, borderLeftColor: t.warning }}>
              <Text style={{ color: t.text, fontWeight: '800', fontSize: 15 }}>API 키를 먼저 입력해 주세요</Text>
              <Muted>설정 탭에서 공공데이터포털 인증키를 입력하면 버스 정보를 볼 수 있습니다. ›</Muted>
            </Card>
          ) : null}

          {/* ── 즐겨찾기 ── */}
          <SectionTitle
            right={
              favorites.length > 0 ? (
                <Pressable onPress={() => setEditing(!editing)} hitSlop={10}>
                  <Text style={{ color: t.primary, fontWeight: '800' }}>{editing ? '완료' : '편집'}</Text>
                </Pressable>
              ) : null
            }
          >
            ⭐ 즐겨찾기 정류장
          </SectionTitle>

          {favorites.length === 0 ? (
            <Card>
              <EmptyState
                icon="star-outline"
                title="즐겨찾기한 정류장이 없습니다"
                body={'아래 가까운 정류장이나 검색 결과에서 ☆ 를 누르면\n이름을 붙여 저장하고, 곧 오는 버스를 바로 볼 수 있습니다.'}
              />
            </Card>
          ) : null}

          {favorites.map((f, i) => {
            const title = f.nickname || f.stop.stopName;
            const dirOk = !isStaleDirection(f.directionLabel);
            const sub = [
              f.nickname ? f.stop.stopName : '',
              dirOk ? `→ ${f.directionLabel}` : '방면 확인 중…',
              REGION_LABELS[f.stop.region],
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <Card key={f.key} onPress={editing ? undefined : () => openStopDetail(f.stop, f.directionLabel)}>
                <View style={styles.favHead}>
                  <Icon name="star" size={18} color="#F5B301" style={{ marginRight: 8 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.favName, { color: t.text }]} numberOfLines={1}>
                      {title}
                    </Text>
                    <Muted numberOfLines={2}>{sub}</Muted>
                  </View>
                  {editing ? (
                    <View style={{ flexDirection: 'row' }}>
                      <Pressable onPress={() => setRenaming(f)} hitSlop={8} style={styles.editBtn}>
                        <Icon name="create-outline" size={20} color={t.primary} />
                      </Pressable>
                      <Pressable
                        onPress={async () => {
                          await moveFavorite(f.key, -1);
                          await load();
                        }}
                        disabled={i === 0}
                        hitSlop={8}
                        style={styles.editBtn}
                      >
                        <Icon name="arrow-up" size={20} color={i === 0 ? t.border : t.primary} />
                      </Pressable>
                      <Pressable
                        onPress={async () => {
                          await moveFavorite(f.key, 1);
                          await load();
                        }}
                        disabled={i === favorites.length - 1}
                        hitSlop={8}
                        style={styles.editBtn}
                      >
                        <Icon name="arrow-down" size={20} color={i === favorites.length - 1 ? t.border : t.primary} />
                      </Pressable>
                      <Pressable onPress={() => remove(f)} hitSlop={8} style={styles.editBtn}>
                        <Icon name="trash-outline" size={20} color={t.danger} />
                      </Pressable>
                    </View>
                  ) : (
                    <Icon name="chevron-forward" size={18} color={t.sub} />
                  )}
                </View>
                {!editing && hasKey ? (
                  <LiveArrivals
                    key={`${f.key}-${refreshKey}`}
                    compact
                    maxRows={3}
                    intervalSec={30}
                    query={{
                      region: f.stop.region,
                      stopNo: f.stop.stopNo,
                      stationId: f.stop.stationId,
                      cityCode: f.stop.cityCode,
                      stopName: f.stop.stopName,
                    }}
                  />
                ) : null}
              </Card>
            );
          })}

          {/* ── 가까운 정류장 ── */}
          <SectionTitle
            right={
              <Pressable onPress={() => void nearby.load(true)} hitSlop={10} disabled={nearby.loading}>
                {nearby.loading ? <ActivityIndicator size="small" /> : <Icon name="refresh" size={18} color={t.primary} />}
              </Pressable>
            }
          >
            📍 가까운 정류장
          </SectionTitle>
          <Card style={{ paddingVertical: 4 }}>
            {nearby.needsPermission ? (
              <View style={{ paddingVertical: 12 }}>
                <Muted style={{ marginBottom: 10 }}>현재 위치를 허용하면 가까운 정류장을 바로 보여 드립니다.</Muted>
                <Button title="위치 권한 허용" icon="location" small onPress={() => void nearby.load(true)} />
              </View>
            ) : nearby.error ? (
              <Muted style={{ paddingVertical: 12, color: t.danger }}>{nearby.error}</Muted>
            ) : nearby.stops.length === 0 ? (
              [0, 1, 2].map((i) => <View key={i} style={[styles.skeleton, { backgroundColor: t.chip }]} />)
            ) : (
              nearby.stops.map((s, i) => {
                const k = stopKeyOf(s);
                const d = dirText(nearby.directions[k]);
                const on = fav.keys.has(k);
                return (
                  <Pressable
                    key={k}
                    onPress={() => {
                      const dd = nearby.directions[k];
                      openStopDetail(s, dd && typeof dd === 'object' ? dd.label : '');
                    }}
                    style={[styles.nearRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.border }]}
                  >
                    <View style={[styles.distBadge, { backgroundColor: t.primarySoft }]}>
                      <Text style={{ color: t.primary, fontWeight: '900', fontSize: 12 }}>{formatDist(s.distanceM)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.text, fontWeight: '800', fontSize: 15.5 }} numberOfLines={1}>
                        {s.stopName}
                      </Text>
                      {d.text ? (
                        <Text style={{ color: d.muted ? t.sub : t.primary, fontWeight: d.muted ? '500' : '700', fontSize: 13 }} numberOfLines={1}>
                          {d.text}
                        </Text>
                      ) : null}
                    </View>
                    <Pressable onPress={() => toggleNearbyFav(s)} hitSlop={12} style={{ paddingHorizontal: 6 }} accessibilityLabel="즐겨찾기">
                      <Icon name={on ? 'star' : 'star-outline'} size={24} color={on ? '#F5B301' : t.sub} />
                    </Pressable>
                  </Pressable>
                );
              })
            )}
            {nearby.stops.length > 0 ? (
              <Pressable
                onPress={() => router.push({ pathname: '/stop-picker', params: { purpose: 'view' } })}
                style={[styles.more, { borderColor: t.border }]}
              >
                <Text style={{ color: t.primary, fontWeight: '800' }}>지도에서 더 보기 ›</Text>
              </Pressable>
            ) : null}
          </Card>

          {/* ── 최근 본 정류장 ── */}
          {recent.length > 0 ? (
            <>
              <SectionTitle>최근 본 정류장</SectionTitle>
              <Card style={{ paddingVertical: 4 }}>
                {recent.map((r, i) => (
                  <Pressable
                    key={r.key}
                    onPress={() => openStopDetail(r.stop, r.directionLabel)}
                    style={[styles.nearRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.border }]}
                  >
                    <Icon name="time-outline" size={18} color={t.sub} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={{ color: t.text, fontWeight: '700' }} numberOfLines={1}>
                        {r.stop.stopName}
                      </Text>
                      {r.directionLabel && !isStaleDirection(r.directionLabel) ? (
                        <Muted numberOfLines={1}>→ {r.directionLabel}</Muted>
                      ) : null}
                    </View>
                    <Pressable onPress={() => void fav.toggle(r.stop, r.directionLabel)} hitSlop={12} style={{ paddingHorizontal: 6 }}>
                      <Icon name={fav.keys.has(r.key) ? 'star' : 'star-outline'} size={22} color={fav.keys.has(r.key) ? '#F5B301' : t.sub} />
                    </Pressable>
                  </Pressable>
                ))}
              </Card>
            </>
          ) : null}
        </View>
      </ScrollView>

      {fav.prompt}
      <NamePrompt
        visible={!!renaming}
        title="즐겨찾기 이름 바꾸기"
        message={renaming ? `${renaming.stop.stopName}${renaming.directionLabel ? `\n→ ${renaming.directionLabel}` : ''}` : ''}
        initial={renaming?.nickname ?? ''}
        placeholder={renaming?.stop.stopName}
        suggestions={['집 앞', '회사', '학교', '출근길', '퇴근길']}
        onCancel={() => setRenaming(null)}
        onSubmit={async (name) => {
          if (renaming) await renameFavorite(renaming.key, name);
          setRenaming(null);
          await load();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: 40 },
  body: { paddingHorizontal: 16, paddingTop: 8 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  quickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 12,
    paddingVertical: 10,
    marginTop: 10,
  },
  quickText: { color: '#FFFFFF', fontWeight: '800', marginLeft: 6 },
  skeleton: { height: 46, borderRadius: 10, marginVertical: 6 },
  nearRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  distBadge: { minWidth: 54, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 8, alignItems: 'center', marginRight: 12 },
  more: { alignItems: 'center', paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  favHead: { flexDirection: 'row', alignItems: 'center' },
  favName: { fontSize: 17, fontWeight: '900' },
  editBtn: { padding: 6, marginLeft: 2 },
});
