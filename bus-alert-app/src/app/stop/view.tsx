/**
 * 정류장 상세: 실시간 도착 정보 · 지도 · 즐겨찾기 · 이 정류장으로 알림/하차 알림 만들기
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LiveArrivals } from '../../components/LiveArrivals';
import { StopMap } from '../../components/StopMap';
import { Button, Card, Icon, Muted, Pill, useTheme } from '../../components/ui';
import { stopDirection } from '../../core/busApi';
import { REGION_LABELS, type StopDirection } from '../../core/types';
import { setPickedStop } from '../../services/pickerStore';
import { stopFromParams } from '../../services/stopNav';
import { useFavorites } from '../../components/useFavorites';
import { addRecentStop, getApiKey, getFavorites, stopKeyOf } from '../../services/storage';

export default function StopViewScreen() {
  const t = useTheme();
  const params = useLocalSearchParams();
  const { stop, dir: dirParam } = useMemo(() => stopFromParams(params), [params]);
  const key = stopKeyOf(stop);
  const favs = useFavorites();
  const fav = favs.keys.has(key);
  const [nickname, setNickname] = useState('');
  const [direction, setDirection] = useState<StopDirection | null>(null);

  useEffect(() => {
    void getFavorites().then((l) => setNickname(l.find((f) => f.key === key)?.nickname ?? ''));
    (async () => {
      let label = dirParam;
      try {
        const d = await stopDirection(await getApiKey(), stop);
        setDirection(d);
        label = d.label || dirParam;
      } catch {
        // 방면 정보 없음
      }
      await addRecentStop(stop, label).catch(() => {});
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const dirLabel = direction?.label || dirParam;

  const toggleFav = useCallback(() => void favs.toggle(stop, dirLabel), [favs, stop, dirLabel]);

  useEffect(() => {
    void getFavorites().then((l) => setNickname(l.find((f) => f.key === key)?.nickname ?? ''));
  }, [favs.keys, key]);

  const picked = () => ({ stop, direction: direction ?? (dirLabel ? { label: dirLabel, routes: [] } : null) });

  const mapStops =
    stop.latitude && stop.longitude
      ? [{ id: key, latitude: stop.latitude, longitude: stop.longitude, label: stop.stopName.slice(0, 12) }]
      : [];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen
        options={{
          title: stop.stopName || '정류장',
          headerRight: () => (
            <Pressable onPress={toggleFav} hitSlop={12} accessibilityLabel={fav ? '즐겨찾기 해제' : '즐겨찾기 추가'}>
              <Icon name={fav ? 'star' : 'star-outline'} size={24} color={fav ? '#FFD34D' : '#FFFFFF'} />
            </Pressable>
          ),
        }}
      />

      <Card>
        {fav && nickname ? <Text style={{ color: '#F5B301', fontWeight: '900', marginBottom: 2 }}>⭐ {nickname}</Text> : null}
        <Text style={[styles.name, { color: t.text }]}>🚏 {stop.stopName}</Text>
        {dirLabel ? (
          <Text style={{ color: t.primary, fontWeight: '800', marginTop: 4 }}>→ {dirLabel}</Text>
        ) : direction?.note ? (
          <Muted style={{ marginTop: 4 }}>{direction.note}</Muted>
        ) : null}
        <View style={styles.pills}>
          <Pill text={REGION_LABELS[stop.region]} icon="location" />
          {stop.stopNo ? <Pill text={`정류소 ${stop.stopNo}`} /> : null}
          {fav ? <Pill text="즐겨찾기" tone="warning" icon="star" /> : null}
        </View>
        {direction?.routes.length ? (
          <Muted style={{ marginTop: 8 }} numberOfLines={2}>
            지나는 노선: {direction.routes.join(', ')}
          </Muted>
        ) : null}
        <Button
          title={fav ? '즐겨찾기 해제' : '즐겨찾기에 추가'}
          icon={fav ? 'star' : 'star-outline'}
          variant="secondary"
          small
          onPress={toggleFav}
          style={{ marginTop: 12, alignSelf: 'flex-start' }}
        />
      </Card>

      <LiveArrivals
        query={{ region: stop.region, stopNo: stop.stopNo, stationId: stop.stationId, cityCode: stop.cityCode, stopName: stop.stopName }}
        maxRows={30}
      />

      {mapStops.length ? (
        <View style={{ marginTop: 12 }}>
          <StopMap
            stops={mapStops}
            selectedId={key}
            arrowTo={
              direction?.nextLatitude && direction.nextLongitude
                ? { latitude: direction.nextLatitude, longitude: direction.nextLongitude }
                : null
            }
            height={220}
          />
          <Muted style={{ marginTop: 6 }}>빨간 화살표: 버스가 가는 방향 (다음 정류장)</Muted>
        </View>
      ) : null}

      <View style={{ height: 14 }} />
      <Button
        title="이 정류장으로 버스 알림 만들기"
        icon="notifications"
        onPress={() => {
          setPickedStop('alarm', picked());
          router.push('/alarm/new');
        }}
      />
      <Button
        title="여기서 내릴래요 (하차 알림)"
        icon="flag"
        variant="secondary"
        onPress={() => {
          setPickedStop('ride', picked());
          router.push('/ride');
        }}
        style={{ marginTop: 10 }}
      />
      {favs.prompt}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48 },
  name: { fontSize: 20, fontWeight: '900' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
});
