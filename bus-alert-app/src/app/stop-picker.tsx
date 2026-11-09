/**
 * 정류장 선택: 이름 검색(예: "명석고") 또는 지도에서 주변 정류장 선택 → 방면 확인 → 선택
 */
import * as Location from 'expo-location';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { LiveArrivals } from '../components/LiveArrivals';
import { StopMap, type MapStop, type StopMapHandle } from '../components/StopMap';
import { Button, Chip, Muted, useTheme } from '../components/ui';
import { distanceM } from '../core/decide';
import { nearbyStops, regionFromAddress, searchStopsByName } from '../core/busApi';
import { REGION_LABELS, type Region, type StopCandidate, type StopDirection } from '../core/types';
import { setPickedStop } from '../services/pickerStore';
import { resolveDirection } from '../services/directionCache';
import { openStopDetail } from '../services/stopNav';
import { getApiKey, stopKeyOf } from '../services/storage';
import { useFavorites } from '../components/useFavorites';

const REGIONS = Object.keys(REGION_LABELS) as Region[];

function stopKey(s: StopCandidate): string {
  return `${s.region}:${s.stationId || s.stopNo}:${s.latitude ?? ''}`;
}

function formatDist(m?: number): string {
  if (m === undefined) return '';
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
}

export default function StopPickerScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ purpose?: string; region?: string; focus?: string }>();
  const purpose = params.purpose ?? 'alarm';

  const [region, setRegion] = useState<Region>((params.region as Region) || 'daejeon');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StopCandidate[]>([]);
  const [mode, setMode] = useState<'nearby' | 'search'>('nearby');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [me, setMe] = useState<{ latitude: number; longitude: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [directions, setDirections] = useState<Record<string, StopDirection | 'loading' | 'error'>>({});
  const mapRef = useRef<StopMapHandle>(null);
  const fav = useFavorites();
  const favKeys = fav.keys;
  const toggleFav = (st: StopCandidate) => {
    const d = directions[stopKey(st)];
    void fav.toggle(st, d && typeof d === 'object' ? d.label : '');
  };
  const resultsRef = useRef<StopCandidate[]>([]);
  const listRef = useRef<FlatList<StopCandidate>>(null);
  const apiKey = useRef('');

  const loadDirection = useCallback(async (s: StopCandidate) => {
    const k = stopKey(s);
    setDirections((d) => (d[k] && d[k] !== 'error' ? d : { ...d, [k]: 'loading' }));
    try {
      const dir = await resolveDirection(s, resultsRef.current);
      setDirections((d) => ({ ...d, [k]: dir }));
    } catch {
      setDirections((d) => ({ ...d, [k]: 'error' }));
    }
  }, []);

  const showResults = useCallback(
    (list: StopCandidate[], from: { latitude: number; longitude: number } | null, byDistance: boolean) => {
      const withDist = list
        .filter((s) => s.stopName)
        .map((s) => ({
          ...s,
          distanceM:
            s.distanceM ??
            (from && s.latitude && s.longitude ? distanceM(from.latitude, from.longitude, s.latitude, s.longitude) : undefined),
        }));
      // 같은 이름(길 건너편 정류장)끼리 붙어 있도록 정렬
      withDist.sort((a, b) => a.stopName.localeCompare(b.stopName, 'ko') || (a.distanceM ?? 0) - (b.distanceM ?? 0));
      let shown = withDist;
      if (byDistance) {
        withDist.sort((a, b) => (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9));
        // 지도를 가깝게 보여 주기 위해 가까운 15곳만
        shown = withDist.slice(0, 15);
      }
      resultsRef.current = withDist;
      setResults(shown);
      setSelected(null);
      // 앞쪽 정류장들의 방면을 미리 불러온다 (동시 3개)
      const first = shown.slice(0, 8);
      let i = 0;
      const worker = async () => {
        while (i < first.length) await loadDirection(first[i++]);
      };
      void Promise.all([worker(), worker(), worker()]);
    },
    [loadDirection],
  );

  const runNearby = useCallback(
    async (center: { latitude: number; longitude: number }, rg: Region) => {
      setLoading(true);
      setError('');
      setMode('nearby');
      try {
        showResults(await nearbyStops(apiKey.current, rg, center.latitude, center.longitude), center, true);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [showResults],
  );

  const runSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    setMode('search');
    try {
      const list = await searchStopsByName(apiKey.current, region, query);
      if (!list.length) setError(`'${query}' 검색 결과가 없습니다. 권역(${REGION_LABELS[region]})을 확인해 주세요.`);
      showResults(list, me, false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query, region, me, showResults]);

  // 첫 진입: 내 위치 → 권역 자동 설정 → 주변 정류장
  useEffect(() => {
    (async () => {
      apiKey.current = await getApiKey();
      if (!apiKey.current) {
        setError('설정에서 공공데이터포털 API 키를 먼저 입력해 주세요.');
        return;
      }
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) return;
        const pos =
          (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 })) ??
          (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        const here = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setMe(here);
        let rg = (params.region as Region) || region;
        try {
          const [addr] = await Location.reverseGeocodeAsync(here);
          const detected = addr ? regionFromAddress([addr.region, addr.city, addr.subregion, addr.district]) : null;
          if (detected && !params.region) {
            rg = detected;
            setRegion(detected);
          }
        } catch {
          // 역지오코딩 실패 시 기존 권역 유지
        }
        await runNearby(here, rg);
      } catch {
        // 위치를 못 얻으면 이름 검색만 사용
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedStop = results.find((s) => stopKey(s) === selected) ?? null;
  const selectedDir = selectedStop ? directions[stopKey(selectedStop)] : undefined;
  const dirObj = selectedDir && typeof selectedDir === 'object' ? selectedDir : null;

  const mapStops: MapStop[] = useMemo(
    () =>
      results
        .filter((s) => s.latitude && s.longitude)
        .map((s) => {
          const d = directions[stopKey(s)];
          const next = d && typeof d === 'object' && d.nextStopName ? ` →${d.nextStopName.slice(0, 8)}` : '';
          return { id: stopKey(s), latitude: s.latitude!, longitude: s.longitude!, label: `${s.stopName.slice(0, 10)}${next}` };
        }),
    [results, directions],
  );

  const select = (s: StopCandidate) => {
    const k = stopKey(s);
    setSelected(k);
    if (!directions[k] || directions[k] === 'error') void loadDirection(s);
  };

  const confirm = () => {
    if (!selectedStop) return;
    if (purpose === 'view') {
      openStopDetail(selectedStop, dirObj?.label ?? '', true);
      return;
    }
    setPickedStop(purpose, { stop: selectedStop, direction: dirObj });
    router.back();
  };

  const renderItem = ({ item }: { item: StopCandidate }) => {
    const k = stopKey(item);
    const d = directions[k];
    const isSel = k === selected;
    return (
      <Pressable
        onPress={() => select(item)}
        style={[
          styles.item,
          { backgroundColor: isSel ? t.chip : t.card, borderColor: isSel ? t.primary : t.border },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.itemTitle, { color: t.text }]}>
            {favKeys.has(stopKeyOf(item)) ? '⭐ ' : '🚏 '}
            {item.stopName}
          </Text>
          {d === 'loading' || d === undefined ? (
            <Text style={{ color: t.sub, marginTop: 2 }}>방면 확인 중…</Text>
          ) : d !== 'error' && d.label ? (
            <Text style={{ color: t.primary, fontWeight: '700', marginTop: 2 }}>→ {d.label}</Text>
          ) : null}
          <Muted>
            {[item.stopNo ? `번호 ${item.stopNo}` : '', formatDist(item.distanceM), REGION_LABELS[item.region]]
              .filter(Boolean)
              .join(' · ')}
          </Muted>
          {d && typeof d === 'object' && d.routes.length > 0 ? (
            <Text numberOfLines={1} style={{ color: t.sub, fontSize: 13 }}>
              노선 {d.routes.slice(0, 12).join(', ')}
            </Text>
          ) : null}
        </View>
        {isSel ? <Text style={{ color: t.primary, fontSize: 20 }}>✓</Text> : null}
      </Pressable>
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen
        options={{ title: purpose === 'ride' ? '내릴 정류장 선택' : purpose === 'view' ? '정류장 검색' : '정류장 선택' }}
      />
      <View style={[styles.top, { backgroundColor: t.card, borderColor: t.border }]}>
        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={runSearch}
            returnKeyType="search"
            autoFocus={params.focus === '1'}
            placeholder="정류장 이름 검색 (예: 명석고)"
            placeholderTextColor={t.sub}
            style={[styles.search, { backgroundColor: t.inputBg, borderColor: t.border, color: t.text }]}
          />
          <Button title="검색" onPress={runSearch} disabled={loading} style={{ marginLeft: 8, paddingHorizontal: 18 }} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          {REGIONS.map((r) => (
            <Chip key={r} label={REGION_LABELS[r]} selected={region === r} onPress={() => setRegion(r)} />
          ))}
        </ScrollView>
      </View>

      <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
        <StopMap
          ref={mapRef}
          stops={mapStops}
          selectedId={selected}
          me={me}
          arrowTo={
            dirObj?.nextLatitude && dirObj?.nextLongitude
              ? { latitude: dirObj.nextLatitude, longitude: dirObj.nextLongitude }
              : null
          }
          onSelect={(id) => {
            const idx = results.findIndex((x) => stopKey(x) === id);
            if (idx < 0) return;
            select(results[idx]);
            // 지도에서 고른 정류장을 목록에서도 보이게
            listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0 });
          }}
          height={260}
        />
        <View style={styles.mapButtons}>
          <Button
            title="📍 이 지역 정류장 찾기"
            variant="secondary"
            onPress={() => {
              const c = mapRef.current?.getCenter() ?? me;
              if (c) void runNearby(c, region);
            }}
            disabled={loading}
            style={{ flex: 1 }}
          />
          {me ? (
            <Button
              title="내 위치"
              variant="secondary"
              onPress={() => {
                mapRef.current?.focus(me.latitude, me.longitude);
                void runNearby(me, region);
              }}
              disabled={loading}
              style={{ marginLeft: 8 }}
            />
          ) : null}
        </View>
      </View>

      {loading ? <ActivityIndicator style={{ marginTop: 10 }} /> : null}
      {error ? <Muted style={{ marginHorizontal: 16, marginTop: 8, color: t.danger }}>{error}</Muted> : null}
      {!loading && !error && results.length > 0 ? (
        <Muted style={{ marginHorizontal: 16, marginTop: 8 }}>
          {mode === 'nearby' ? '주변 정류장' : `'${query}' 검색 결과`} {results.length}곳 · 같은 이름은 길 건너편 정류장입니다. 방면을 보고
          고르세요.
        </Muted>
      ) : null}

      <FlatList
        ref={listRef}
        onScrollToIndexFailed={(info) =>
          listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true })
        }
        data={results}
        keyExtractor={(s, i) => `${stopKey(s)}-${i}`}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 12, paddingBottom: selectedStop ? 380 : 40 }}
        keyboardShouldPersistTaps="handled"
      />

      {selectedStop ? (
        <View style={[styles.bottom, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[styles.itemTitle, { color: t.text }]} numberOfLines={1}>
            {selectedStop.stopName}
            {dirObj?.label ? ` · ${dirObj.label}` : ''}
          </Text>
          <ScrollView style={{ maxHeight: 230 }} nestedScrollEnabled>
            <LiveArrivals
              query={{
                region: selectedStop.region,
                stopNo: selectedStop.stopNo,
                stationId: selectedStop.stationId,
                cityCode: selectedStop.cityCode,
                stopName: selectedStop.stopName,
              }}
              maxRows={8}
            />
          </ScrollView>
          <View style={{ flexDirection: 'row', marginTop: 8 }}>
            <Button
              title={favKeys.has(stopKeyOf(selectedStop)) ? '★' : '☆'}
              variant="secondary"
              onPress={() => void toggleFav(selectedStop)}
              style={{ marginRight: 8, paddingHorizontal: 18 }}
            />
            <Button
              title={purpose === 'view' ? '도착 정보 크게 보기' : '이 정류장 선택'}
              onPress={confirm}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      ) : null}
      {fav.prompt}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  top: { padding: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  searchRow: { flexDirection: 'row', alignItems: 'center' },
  search: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  mapButtons: { flexDirection: 'row', marginTop: 8 },
  item: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  itemTitle: { fontSize: 16, fontWeight: '700' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
});
