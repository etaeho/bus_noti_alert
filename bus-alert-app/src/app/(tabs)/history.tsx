/**
 * 알림 기록: 앱이 보낸 알림을 날짜별로 보여준다.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import { Chip, EmptyState, Icon, useTheme, type IconName } from '../../components/ui';
import { clearHistory, getHistory, markHistorySeen, type HistoryEntry, type HistoryKind } from '../../services/storage';

const KIND_META: Record<HistoryKind, { icon: IconName; label: string; color: 'primary' | 'success' | 'warning' | 'sub' }> = {
  stage: { icon: 'bus', label: '정거장 알림', color: 'primary' },
  arrival: { icon: 'time', label: '도착 알림', color: 'primary' },
  ride: { icon: 'flag', label: '하차 알림', color: 'success' },
  start: { icon: 'play-circle', label: '감시 시작', color: 'warning' },
  test: { icon: 'flask', label: '테스트', color: 'sub' },
};

type Filter = 'all' | 'bus' | 'ride';

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return '오늘';
  if (diff === 1) return '어제';
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`;
}

function timeLabel(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function HistoryScreen() {
  const t = useTheme();
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setItems(await getHistory());
    await markHistorySeen();
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const sections = useMemo(() => {
    const filtered = items.filter((e) =>
      filter === 'all' ? true : filter === 'ride' ? e.kind === 'ride' : e.kind !== 'ride' && e.kind !== 'test',
    );
    const map = new Map<string, HistoryEntry[]>();
    for (const e of filtered) {
      const k = dayLabel(e.at);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    return [...map.entries()].map(([title, data]) => ({ title, data }));
  }, [items, filter]);

  const colorOf = (c: 'primary' | 'success' | 'warning' | 'sub') =>
    c === 'primary' ? t.primary : c === 'success' ? t.success : c === 'warning' ? t.warning : t.sub;

  const clear = () =>
    Alert.alert('알림 기록 삭제', '모든 알림 기록을 지울까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          await clearHistory();
          setItems([]);
        },
      },
    ]);

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.filters, { backgroundColor: t.card, borderColor: t.border }]}>
        <Chip label="전체" selected={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip label="버스 도착" selected={filter === 'bus'} onPress={() => setFilter('bus')} />
        <Chip label="하차" selected={filter === 'ride'} onPress={() => setFilter('ride')} />
        <View style={{ flex: 1 }} />
        {items.length > 0 ? (
          <Pressable onPress={clear} hitSlop={10} style={{ marginBottom: 8 }}>
            <Text style={{ color: t.danger, fontWeight: '700' }}>지우기</Text>
          </Pressable>
        ) : null}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 40, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.day, { color: t.sub }]}>{section.title}</Text>
        )}
        renderItem={({ item }) => {
          const meta = KIND_META[item.kind] ?? KIND_META.arrival;
          const color = colorOf(meta.color);
          const open = expanded === item.id;
          return (
            <Pressable
              onPress={() => setExpanded(open ? null : item.id)}
              style={[styles.item, { backgroundColor: t.card, shadowColor: t.shadow }]}
            >
              <View style={[styles.icon, { backgroundColor: color + '1F' }]}>
                <Icon name={meta.icon} size={18} color={color} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.itemTop}>
                  <Text style={[styles.kind, { color }]}>{meta.label}</Text>
                  <Text style={{ color: t.sub, fontSize: 12 }}>{timeLabel(item.at)}</Text>
                </View>
                <Text style={[styles.title, { color: t.text }]}>{item.title}</Text>
                <Text style={{ color: t.sub, fontSize: 13, lineHeight: 19 }} numberOfLines={open ? undefined : 2}>
                  {item.body}
                </Text>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            icon="notifications-off-outline"
            title="아직 받은 알림이 없습니다"
            body="버스 도착 알림이나 하차 알림을 받으면 여기에 기록됩니다."
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  filters: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  day: { fontSize: 13, fontWeight: '800', marginTop: 8, marginBottom: 8, marginLeft: 4 },
  item: {
    flexDirection: 'row',
    padding: 14,
    borderRadius: 16,
    marginBottom: 10,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  itemTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  kind: { fontSize: 12, fontWeight: '800' },
  title: { fontSize: 15, fontWeight: '800', marginBottom: 2 },
});
