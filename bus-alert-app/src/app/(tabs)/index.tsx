/**
 * 정류장 탭 (첫 화면) - 지도 + 바텀시트
 *  - 화면 전체가 지도: 즐겨찾기 · 가까운 정류장이 핀으로 표시되고, 누르면 아래 시트에 실시간 도착 정보
 *  - 시트 위쪽 칩: 즐겨찾기(이름) → 바로 전환, "주변 N" → 가까운 정류장 목록
 *  - 시트는 손잡이를 끌어 올리거나 내릴 수 있음
 */
import { router, useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LiveArrivals } from '../../components/LiveArrivals';
import { NamePrompt } from '../../components/NamePrompt';
import { StopMap, type MapStop, type StopMapHandle } from '../../components/StopMap';
import { Button, Icon, useTheme } from '../../components/ui';
import { useFavorites } from '../../components/useFavorites';
import { distanceM } from '../../core/decide';
import type { StopCandidate, StopDirection } from '../../core/types';
import { resolveDirection } from '../../services/directionCache';
import { openStopDetail } from '../../services/stopNav';
import {
  getApiKey,
  getFavorites,
  isStaleDirection,
  moveFavorite,
  removeFavorite,
  renameFavorite,
  stopKeyOf,
  type FavoriteStop,
} from '../../services/storage';
import { useNearbyStops } from '../../services/useNearbyStops';

function formatDist(m?: number): string {
  if (m === undefined || !Number.isFinite(m)) return '';
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
}

function withDirSuffix(label: string): string {
  if (!label) return '';
  return /방면$/.test(label) ? label : `${label} 방면`;
}

type Mode = 'stop' | 'nearby';

export default function StopsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<StopMapHandle>(null);
  const fav = useFavorites();
  const nearby = useNearbyStops(8);

  const [favorites, setFavorites] = useState<FavoriteStop[]>([]);
  const [hasKey, setHasKey] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('stop');
  const [renaming, setRenaming] = useState<FavoriteStop | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [dir, setDir] = useState<StopDirection | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [areaH, setAreaH] = useState(0);

  // ── 데이터 ──
  const load = useCallback(async () => {
    const [f, k] = await Promise.all([getFavorites(), getApiKey()]);
    setFavorites(f);
    setHasKey(!!k);
    await fav.refresh();
  }, [fav]);

  useFocusEffect(
    useCallback(() => {
      void load();
      // 지도 위에서는 상태 표시줄 아이콘을 어둡게
      setStatusBarStyle('dark');
      return () => setStatusBarStyle('auto');
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  useEffect(() => {
    void nearby.load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void getFavorites().then(setFavorites);
  }, [fav.keys]);

  // 예전 버전이 저장한 추정 방면은 실제 방면으로 다시 확인
  const refreshingDirs = useRef(false);
  useEffect(() => {
    const stale = favorites.filter((f) => isStaleDirection(f.directionLabel));
    if (!stale.length || refreshingDirs.current || !hasKey) return;
    refreshingDirs.current = true;
    void (async () => {
      for (const f of stale) {
        try {
          await resolveDirection(f.stop);
        } catch {
          // 다음 기회에
        }
      }
      setFavorites(await getFavorites());
      refreshingDirs.current = false;
    })();
  }, [favorites, hasKey]);

  // 지도에 올릴 정류장 = 즐겨찾기 + 가까운 정류장
  const allStops = useMemo(() => {
    const m = new Map<string, { stop: StopCandidate; label: string }>();
    for (const f of favorites) m.set(f.key, { stop: f.stop, label: f.nickname || f.stop.stopName });
    for (const s of nearby.stops) {
      const k = stopKeyOf(s);
      if (!m.has(k)) m.set(k, { stop: s, label: s.stopName });
    }
    return m;
  }, [favorites, nearby.stops]);

  const mapStops: MapStop[] = useMemo(
    () =>
      [...allStops.entries()]
        .filter(([, v]) => v.stop.latitude != null && v.stop.longitude != null)
        .map(([id, v]) => ({ id, latitude: v.stop.latitude!, longitude: v.stop.longitude!, label: v.label })),
    [allStops],
  );

  // 처음 선택: 첫 즐겨찾기 → 없으면 가장 가까운 정류장
  // 처음 선택: 내 위치에서 가장 가까운 정류장 → 위치를 못 쓰면 첫 즐겨찾기
  const userPicked = useRef(false);
  useEffect(() => {
    if (userPicked.current && selectedKey && allStops.has(selectedKey)) return;
    if (nearby.stops[0]) {
      const k = stopKeyOf(nearby.stops[0]);
      if (k !== selectedKey) setSelectedKey(k);
      return;
    }
    if (!nearby.attempted || nearby.loading) return; // 위치 확인 중에는 기다림
    if (selectedKey && allStops.has(selectedKey)) return;
    const first = favorites[0]?.key ?? null;
    if (first) setSelectedKey(first);
  }, [favorites, nearby.stops, nearby.attempted, nearby.loading, selectedKey, allStops]);

  const selected = selectedKey ? allStops.get(selectedKey) : undefined;
  const selectedFav = favorites.find((f) => f.key === selectedKey);

  // 선택 정류장의 방면 (지도 화살표 · 머리말)
  useEffect(() => {
    setDir(null);
    setUpdatedAt(null);
    if (!selected || !hasKey) return;
    let alive = true;
    void resolveDirection(selected.stop, nearby.stops, 6 * 3600_000)
      .then((d) => alive && setDir(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, hasKey]);

  const dirLabel = (() => {
    if (selectedFav && !isStaleDirection(selectedFav.directionLabel)) return selectedFav.directionLabel;
    const nd = selectedKey ? nearby.directions[selectedKey] : undefined;
    if (nd && typeof nd === 'object' && nd.label) return nd.label;
    return dir?.label ?? '';
  })();

  const dist =
    selected?.stop.distanceM ??
    (nearby.me && selected?.stop.latitude != null && selected.stop.longitude != null
      ? distanceM(nearby.me.latitude, nearby.me.longitude, selected.stop.latitude, selected.stop.longitude)
      : undefined);

  const arrowTo =
    dir?.nextLatitude != null && dir.nextLongitude != null ? { latitude: dir.nextLatitude, longitude: dir.nextLongitude } : null;

  // ── 바텀시트 ──
  const expandedTop = insets.top + 76; // 검색창 아래
  const collapsedTop = Math.max(expandedTop + 40, Math.round(areaH * 0.43));
  const travel = Math.max(0, collapsedTop - expandedTop);
  const y = useRef(new Animated.Value(0)).current; // 0 = 펼침, travel = 접힘
  const yNow = useRef(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const id = y.addListener(({ value }) => (yNow.current = value));
    return () => y.removeListener(id);
  }, [y]);

  useEffect(() => {
    if (!travel) return;
    y.setValue(expanded ? 0 : travel);
    // 높이가 정해졌을 때 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [travel]);

  const snap = useCallback(
    (open: boolean) => {
      setExpanded(open);
      Animated.spring(y, { toValue: open ? 0 : travel, useNativeDriver: true, bounciness: 2, speed: 16 }).start();
    },
    [travel, y],
  );

  const startY = useRef(0);
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderGrant: () => {
          y.stopAnimation();
          startY.current = yNow.current;
        },
        onPanResponderMove: (_, g) => y.setValue(Math.min(travel, Math.max(0, startY.current + g.dy))),
        onPanResponderRelease: (_, g) => {
          const end = startY.current + g.dy;
          snap(g.vy < -0.4 ? true : g.vy > 0.4 ? false : end < travel / 2);
        },
        onPanResponderTerminate: () => snap(yNow.current < travel / 2),
      }),
    [travel, y, snap],
  );

  // ── 동작 ──
  const select = (key: string) => {
    userPicked.current = true;
    setSelectedKey(key);
    setMode('stop');
    const s = allStops.get(key)?.stop;
    if (s?.latitude != null && s.longitude != null) mapRef.current?.focus(s.latitude, s.longitude, 17);
  };

  const toggleStar = () => {
    if (!selected) return;
    void fav.toggle(selected.stop, dirLabel);
  };

  const favMenu = (f: FavoriteStop, i: number) =>
    Alert.alert(f.nickname || f.stop.stopName, f.stop.stopName, [
      { text: '이름 바꾸기', onPress: () => setRenaming(f) },
      ...(i > 0
        ? [
            {
              text: '앞으로 옮기기',
              onPress: async () => {
                await moveFavorite(f.key, -1);
                await load();
              },
            },
          ]
        : []),
      {
        text: '즐겨찾기 삭제',
        style: 'destructive' as const,
        onPress: async () => {
          await removeFavorite(f.key);
          await load();
        },
      },
      { text: '닫기', style: 'cancel' as const },
    ]);

  const goMyLocation = () => {
    if (nearby.me) mapRef.current?.focus(nearby.me.latitude, nearby.me.longitude, 17);
    void nearby.load(true);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    await nearby.load(false);
    setRefreshKey((k) => k + 1);
    setRefreshing(false);
  };

  const onLayout = (e: LayoutChangeEvent) => setAreaH(e.nativeEvent.layout.height);
  const visibleSheetH = areaH - collapsedTop;
  const starOn = !!selectedKey && fav.keys.has(selectedKey);

  return (
    <View style={{ flex: 1, backgroundColor: '#E9EDF1' }} onLayout={onLayout}>
      {/* 지도 */}
      {areaH > 0 && (nearby.me || selected || nearby.attempted) ? (
        <View style={StyleSheet.absoluteFill}>
          <StopMap
            ref={mapRef}
            flat
            height={areaH}
            stops={mapStops}
            selectedId={selectedKey}
            me={nearby.me}
            arrowTo={arrowTo}
            bottomInset={visibleSheetH}
            onSelect={select}
          />
        </View>
      ) : null}

      {/* 떠 있는 검색창 */}
      <View style={[styles.topBar, { top: insets.top + 12 }]}>
        <Pressable
          onPress={() => router.push({ pathname: '/stop-picker', params: { purpose: 'view', focus: '1' } })}
          style={[styles.searchPill, styles.float]}
          accessibilityRole="search"
        >
          <Icon name="search" size={19} color="#6E7681" />
          <Text style={styles.searchText}>정류장 검색</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setMode('stop');
            if (favorites[0]) select(favorites[0].key);
            snap(true);
          }}
          style={[styles.roundBtn, styles.float]}
          accessibilityLabel="즐겨찾기"
        >
          <Icon name="star" size={21} color="#FFB800" />
        </Pressable>
      </View>

      {/* 내 위치 */}
      <Animated.View
        style={[styles.myLoc, { top: collapsedTop - 60, opacity: y.interpolate({ inputRange: [0, Math.max(1, travel)], outputRange: [0, 1] }) }]}
        pointerEvents={expanded ? 'none' : 'auto'}
      >
        <Pressable onPress={goMyLocation} style={[styles.roundBtn, styles.float, { width: 46, height: 46 }]} accessibilityLabel="내 위치">
          {nearby.loading ? <ActivityIndicator size="small" /> : <Icon name="navigate" size={20} color={t.primary} />}
        </Pressable>
      </Animated.View>

      {/* 바텀시트 */}
      {areaH > 0 ? (
        <Animated.View
          style={[
            styles.sheet,
            { top: expandedTop, backgroundColor: t.card, shadowColor: t.shadow, transform: [{ translateY: y }] },
          ]}
        >
          <View {...pan.panHandlers}>
            <Pressable onPress={() => snap(!expanded)} style={styles.grabArea} accessibilityLabel={expanded ? '시트 내리기' : '시트 올리기'}>
              <View style={[styles.grabber, { backgroundColor: t.border }]} />
            </Pressable>

            {mode === 'stop' && selected ? (
              <View style={styles.sheetHead}>
                <Pressable style={{ flex: 1 }} onPress={() => openStopDetail(selected.stop, dirLabel)}>
                  <Text style={[styles.stopTitle, { color: t.text }]} numberOfLines={1}>
                    {selectedFav?.nickname || selected.stop.stopName}
                  </Text>
                  <Text style={[styles.stopSub, { color: t.sub }]} numberOfLines={1}>
                    {[
                      selectedFav?.nickname ? selected.stop.stopName : '',
                      selected.stop.stopNo,
                      withDirSuffix(dirLabel),
                      formatDist(dist),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={toggleStar}
                  style={[styles.starBtn, { backgroundColor: starOn ? '#FFF6DB' : t.chip }]}
                  accessibilityLabel={starOn ? '즐겨찾기 해제' : '즐겨찾기 추가'}
                >
                  <Icon name={starOn ? 'star' : 'star-outline'} size={21} color={starOn ? '#FFB800' : t.sub} />
                </Pressable>
              </View>
            ) : mode === 'nearby' ? (
              <View style={styles.sheetHead}>
                <Text style={[styles.stopTitle, { color: t.text, flex: 1 }]}>가까운 정류장</Text>
                <Pressable onPress={() => void nearby.load(true)} hitSlop={10} style={[styles.starBtn, { backgroundColor: t.chip }]} accessibilityLabel="새로고침">
                  {nearby.loading ? <ActivityIndicator size="small" /> : <Icon name="refresh" size={19} color={t.text} />}
                </Pressable>
              </View>
            ) : (
              <View style={styles.sheetHead}>
                <Text style={[styles.stopTitle, { color: t.text }]}>정류장</Text>
              </View>
            )}

            {/* 칩: 즐겨찾기 · 주변 */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {favorites.map((f, i) => {
                const on = mode === 'stop' && f.key === selectedKey;
                return (
                  <Pressable
                    key={f.key}
                    onPress={() => select(f.key)}
                    onLongPress={() => favMenu(f, i)}
                    style={[styles.chip, { backgroundColor: on ? t.text : t.chip }]}
                  >
                    <Text style={[styles.chipText, { color: on ? t.card : t.text, fontWeight: on ? '700' : '600' }]} numberOfLines={1}>
                      {f.nickname || f.stop.stopName}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => {
                  setMode('nearby');
                  snap(true);
                }}
                style={[styles.chip, { backgroundColor: mode === 'nearby' ? t.text : t.chip }]}
              >
                <Icon name="location-outline" size={14} color={mode === 'nearby' ? t.card : t.text} />
                <Text style={[styles.chipText, { color: mode === 'nearby' ? t.card : t.text, marginLeft: 3 }]}>
                  주변{nearby.stops.length ? ` ${nearby.stops.length}` : ''}
                </Text>
              </Pressable>
            </ScrollView>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: travel + 32 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            {!hasKey ? (
              <Pressable onPress={() => router.push('/settings')} style={[styles.notice, { backgroundColor: t.warningSoft }]}>
                <Text style={{ color: t.text, fontWeight: '700', fontSize: 15 }}>API 키를 먼저 입력해 주세요</Text>
                <Text style={{ color: t.sub, marginTop: 2 }}>설정 탭에서 공공데이터포털 인증키를 입력하면 버스 정보를 볼 수 있습니다.</Text>
              </Pressable>
            ) : null}

            {mode === 'stop' ? (
              selected ? (
                hasKey ? (
                  <>
                    <LiveArrivals
                      key={`${selectedKey}-${refreshKey}`}
                      sheet
                      intervalSec={20}
                      onUpdated={setUpdatedAt}
                      query={{
                        region: selected.stop.region,
                        stopNo: selected.stop.stopNo,
                        stationId: selected.stop.stationId,
                        cityCode: selected.stop.cityCode,
                        stopName: selected.stop.stopName,
                      }}
                    />
                    <View style={styles.footRow}>
                      <Text style={{ color: t.sub, fontSize: 12 }}>
                        {updatedAt ? `${updatedAt.toLocaleTimeString('ko-KR', { hour12: false })} 기준 · 20초마다 갱신` : ''}
                      </Text>
                      <Pressable onPress={() => openStopDetail(selected.stop, dirLabel)} hitSlop={8}>
                        <Text style={{ color: t.primary, fontWeight: '700', fontSize: 13 }}>정류장 자세히</Text>
                      </Pressable>
                    </View>
                  </>
                ) : null
              ) : (
                <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                  {nearby.needsPermission ? (
                    <>
                      <Text style={{ color: t.sub, marginBottom: 12, textAlign: 'center' }}>
                        위치를 허용하면 가까운 정류장을 지도에 바로 보여 드립니다.
                      </Text>
                      <Button title="위치 권한 허용" icon="location" small onPress={() => void nearby.load(true)} />
                    </>
                  ) : nearby.error ? (
                    <Text style={{ color: t.danger }}>{nearby.error}</Text>
                  ) : (
                    <ActivityIndicator />
                  )}
                </View>
              )
            ) : (
              <>
                {nearby.needsPermission ? (
                  <View style={{ paddingVertical: 16 }}>
                    <Text style={{ color: t.sub, marginBottom: 10 }}>현재 위치를 허용하면 가까운 정류장을 보여 드립니다.</Text>
                    <Button title="위치 권한 허용" icon="location" small onPress={() => void nearby.load(true)} />
                  </View>
                ) : nearby.error ? (
                  <Text style={{ color: t.danger, paddingVertical: 16 }}>{nearby.error}</Text>
                ) : nearby.stops.length === 0 ? (
                  [0, 1, 2].map((i) => <View key={i} style={[styles.skeleton, { backgroundColor: t.chip }]} />)
                ) : (
                  nearby.stops.map((s, i) => {
                    const k = stopKeyOf(s);
                    const d = nearby.directions[k];
                    const sub =
                      d === undefined || d === 'loading'
                        ? '방면 확인 중…'
                        : d === 'error'
                          ? ''
                          : d.label
                            ? withDirSuffix(d.label)
                            : d.routes.slice(0, 6).join(' · ');
                    const on = fav.keys.has(k);
                    return (
                      <Pressable
                        key={k}
                        onPress={() => select(k)}
                        style={[styles.nearRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.border }]}
                      >
                        <View style={[styles.pinDot, { backgroundColor: t.primarySoft }]}>
                          <Icon name="location" size={15} color={t.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: t.text, fontWeight: '600', fontSize: 15 }} numberOfLines={1}>
                            {s.stopName}
                          </Text>
                          {sub ? (
                            <Text style={{ color: t.sub, fontSize: 12.5 }} numberOfLines={1}>
                              {sub}
                            </Text>
                          ) : null}
                        </View>
                        <Text style={{ color: t.sub, fontSize: 13, marginRight: 6 }}>{formatDist(s.distanceM)}</Text>
                        <Pressable
                          onPress={() => void fav.toggle(s, d && typeof d === 'object' ? d.label : '')}
                          hitSlop={10}
                          style={{ padding: 4 }}
                          accessibilityLabel={on ? '즐겨찾기 해제' : '즐겨찾기 추가'}
                        >
                          <Icon name={on ? 'star' : 'star-outline'} size={21} color={on ? '#FFB800' : t.sub} />
                        </Pressable>
                      </Pressable>
                    );
                  })
                )}
                <Pressable
                  onPress={() => router.push({ pathname: '/stop-picker', params: { purpose: 'view' } })}
                  style={[styles.moreBtn, { backgroundColor: t.chip }]}
                >
                  <Text style={{ color: t.text, fontWeight: '700' }}>지도에서 다른 정류장 찾기</Text>
                </Pressable>
              </>
            )}

            {favorites.length > 0 && mode === 'stop' ? (
              <Text style={{ color: t.sub, fontSize: 12, marginTop: 14 }}>즐겨찾기 칩을 길게 누르면 이름 바꾸기 · 순서 · 삭제</Text>
            ) : null}
          </ScrollView>
        </Animated.View>
      ) : null}

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
  float: {
    shadowColor: '#111418',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row' },
  searchPill: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginRight: 10,
  },
  searchText: { color: '#6E7681', fontSize: 15.5, marginLeft: 8 },
  roundBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  myLoc: { position: 'absolute', right: 16 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
    elevation: 12,
  },
  grabArea: { alignItems: 'center', paddingTop: 8, paddingBottom: 6 },
  grabber: { width: 38, height: 5, borderRadius: 3 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 6 },
  stopTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.5 },
  stopSub: { fontSize: 13, marginTop: 1 },
  starBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginLeft: 10 },
  chips: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', height: 34, paddingHorizontal: 14, borderRadius: 17, marginRight: 8 },
  chipText: { fontSize: 13.5, maxWidth: 140 },
  notice: { borderRadius: 14, padding: 14, marginTop: 8 },
  footRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  nearRow: { flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingVertical: 8 },
  pinDot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  skeleton: { height: 50, borderRadius: 10, marginVertical: 6 },
  moreBtn: { alignItems: 'center', justifyContent: 'center', height: 46, borderRadius: 14, marginTop: 14 },
});
