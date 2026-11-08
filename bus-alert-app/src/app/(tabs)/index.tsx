/**
 * 정류장 탭 (첫 화면): 정류장 검색 · 내 주변 정류장 · 즐겨찾기 정류장 실시간 도착 정보
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LiveArrivals } from '../../components/LiveArrivals';
import { Button, Card, EmptyState, Icon, Muted, SectionTitle, useTheme } from '../../components/ui';
import { REGION_LABELS } from '../../core/types';
import { openStopDetail } from '../../services/stopNav';
import {
  getApiKey,
  getFavorites,
  getRecentStops,
  moveFavorite,
  removeFavorite,
  type FavoriteStop,
} from '../../services/storage';

export default function StopsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [favorites, setFavorites] = useState<FavoriteStop[]>([]);
  const [recent, setRecent] = useState<FavoriteStop[]>([]);
  const [hasKey, setHasKey] = useState(true);
  const [editing, setEditing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [f, r, k] = await Promise.all([getFavorites(), getRecentStops(), getApiKey()]);
    setFavorites(f);
    setRecent(r.filter((x) => !f.some((y) => y.key === x.key)).slice(0, 5));
    setHasKey(!!k);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const remove = (f: FavoriteStop) =>
    Alert.alert('즐겨찾기 삭제', `${f.stop.stopName}을(를) 즐겨찾기에서 뺄까요?`, [
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

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 12 }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshKey((k) => k + 1);
            setRefreshing(false);
          }}
        />
      }
    >
      <Text style={[styles.h1, { color: t.text }]}>정류장</Text>
      <Muted style={{ marginBottom: 14 }}>정류장을 찾아 실시간 버스 도착 시간을 확인하세요.</Muted>

      <Pressable
        onPress={() => router.push({ pathname: '/stop-picker', params: { purpose: 'view', focus: '1' } })}
        style={[styles.search, { backgroundColor: t.card, borderColor: t.border, shadowColor: t.shadow }]}
        accessibilityRole="search"
      >
        <Icon name="search" size={20} color={t.sub} />
        <Text style={{ color: t.sub, fontSize: 16, marginLeft: 10, flex: 1 }}>정류장 이름 검색 (예: 명석고)</Text>
      </Pressable>
      <View style={styles.quick}>
        <Button
          title="내 주변 정류장"
          icon="navigate"
          variant="secondary"
          small
          onPress={() => router.push({ pathname: '/stop-picker', params: { purpose: 'view' } })}
          style={{ flex: 1, marginRight: 8 }}
        />
        <Button
          title="지도에서 찾기"
          icon="map"
          variant="secondary"
          small
          onPress={() => router.push({ pathname: '/stop-picker', params: { purpose: 'view' } })}
          style={{ flex: 1 }}
        />
      </View>

      {!hasKey ? (
        <Card onPress={() => router.push('/settings')} style={{ borderLeftWidth: 4, borderLeftColor: t.warning }}>
          <Text style={{ color: t.text, fontWeight: '800', fontSize: 15 }}>API 키를 먼저 입력해 주세요</Text>
          <Muted>설정 탭에서 공공데이터포털 인증키를 입력하면 버스 정보를 볼 수 있습니다. ›</Muted>
        </Card>
      ) : null}

      <SectionTitle
        right={
          favorites.length > 1 ? (
            <Pressable onPress={() => setEditing(!editing)} hitSlop={10}>
              <Text style={{ color: t.primary, fontWeight: '800' }}>{editing ? '완료' : '순서 편집'}</Text>
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
            body={'정류장을 검색한 뒤 ☆ 를 누르면 여기에 추가되고,\n곧 오는 버스를 바로 볼 수 있습니다.'}
            action={
              <Button
                title="정류장 찾기"
                icon="search"
                onPress={() => router.push({ pathname: '/stop-picker', params: { purpose: 'view', focus: '1' } })}
              />
            }
          />
        </Card>
      ) : null}

      {favorites.map((f, i) => (
        <Card key={f.key} onPress={editing ? undefined : () => openStopDetail(f.stop, f.directionLabel)}>
          <View style={styles.favHead}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.favName, { color: t.text }]} numberOfLines={1}>
                {f.stop.stopName}
              </Text>
              <Muted numberOfLines={1}>
                {[f.directionLabel ? `→ ${f.directionLabel}` : '', REGION_LABELS[f.stop.region], f.stop.stopNo ? `${f.stop.stopNo}` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </Muted>
            </View>
            {editing ? (
              <View style={{ flexDirection: 'row' }}>
                <Pressable onPress={async () => { await moveFavorite(f.key, -1); await load(); }} disabled={i === 0} hitSlop={8} style={styles.editBtn}>
                  <Icon name="arrow-up" size={20} color={i === 0 ? t.border : t.primary} />
                </Pressable>
                <Pressable
                  onPress={async () => { await moveFavorite(f.key, 1); await load(); }}
                  disabled={i === favorites.length - 1}
                  hitSlop={8}
                  style={styles.editBtn}
                >
                  <Icon name="arrow-down" size={20} color={i === favorites.length - 1 ? t.border : t.primary} />
                </Pressable>
                <Pressable onPress={() => remove(f)} hitSlop={8} style={styles.editBtn}>
                  <Icon name="trash" size={20} color={t.danger} />
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
      ))}

      {recent.length > 0 ? (
        <>
          <SectionTitle>최근 본 정류장</SectionTitle>
          <Card>
            {recent.map((r, i) => (
              <Pressable
                key={r.key}
                onPress={() => openStopDetail(r.stop, r.directionLabel)}
                style={[styles.recentRow, i < recent.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border }]}
              >
                <Icon name="time-outline" size={18} color={t.sub} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={{ color: t.text, fontWeight: '700' }} numberOfLines={1}>
                    {r.stop.stopName}
                  </Text>
                  {r.directionLabel ? <Muted numberOfLines={1}>→ {r.directionLabel}</Muted> : null}
                </View>
                <Icon name="chevron-forward" size={16} color={t.sub} />
              </Pressable>
            ))}
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingBottom: 40 },
  h1: { fontSize: 28, fontWeight: '900' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  quick: { flexDirection: 'row', marginTop: 10, marginBottom: 6 },
  favHead: { flexDirection: 'row', alignItems: 'center' },
  favName: { fontSize: 17, fontWeight: '800' },
  editBtn: { padding: 6, marginLeft: 4 },
  recentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
});
