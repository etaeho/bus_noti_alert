/**
 * Google 지도 버전 정류장 지도 (빌드 시 GOOGLE_MAPS_API_KEY 가 있을 때만 사용)
 * StopMap 과 같은 props / ref 인터페이스.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';

import type { StopMapHandle, StopMapProps } from './StopMap';

export const GoogleStopMap = forwardRef<StopMapHandle, StopMapProps>(function GoogleStopMap(
  { stops, selectedId, me, arrowTo, onSelect, onMoved, height = 300 },
  ref,
) {
  const map = useRef<MapView>(null);
  const region = useRef<Region | null>(null);
  const lastFitKey = useRef('');

  useImperativeHandle(ref, () => ({
    getCenter: () => (region.current ? { latitude: region.current.latitude, longitude: region.current.longitude } : null),
    focus: (latitude, longitude, zoom) => {
      const delta = zoom && zoom >= 17 ? 0.004 : 0.01;
      map.current?.animateToRegion({ latitude, longitude, latitudeDelta: delta, longitudeDelta: delta }, 400);
    },
  }));

  // 결과/선택이 바뀌면 화면 맞춤
  useEffect(() => {
    const sel = stops.find((s) => s.id === selectedId);
    const key = `${stops.map((s) => s.id).join(',')}|${selectedId ?? ''}|${arrowTo ? 'a' : ''}`;
    if (key === lastFitKey.current) return;
    lastFitKey.current = key;
    const coords = sel
      ? [sel, ...(arrowTo ? [arrowTo] : [])].map((p) => ({ latitude: p.latitude, longitude: p.longitude }))
      : stops.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
    if (!sel && me && coords.length > 1) {
      // 현재 위치 기준 가까운 6곳만 보이게 확대
      const d2 = (p: { latitude: number; longitude: number }) => (p.latitude - me.latitude) ** 2 + (p.longitude - me.longitude) ** 2;
      coords.sort((a, b) => d2(a) - d2(b));
      coords.splice(6);
      coords.push(me);
    }
    if (coords.length === 0 && me) coords.push(me);
    if (coords.length === 1) {
      map.current?.animateToRegion({ ...coords[0], latitudeDelta: 0.003, longitudeDelta: 0.003 }, 400);
    } else if (coords.length > 1) {
      map.current?.fitToCoordinates(coords, { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true });
    }
  }, [stops, selectedId, arrowTo, me]);

  const sel = stops.find((s) => s.id === selectedId);

  return (
    <View style={[styles.wrap, { height }]}>
      <MapView
        ref={map}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: me?.latitude ?? 36.35,
          longitude: me?.longitude ?? 127.38,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        }}
        showsUserLocation={!!me}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        onRegionChangeComplete={(r) => {
          region.current = r;
          onMoved?.({ latitude: r.latitude, longitude: r.longitude });
        }}
      >
        {stops.map((s) => (
          <Marker
            key={s.id}
            identifier={s.id}
            coordinate={{ latitude: s.latitude, longitude: s.longitude }}
            title={s.label}
            pinColor={s.id === selectedId ? '#D93B3B' : '#1E6FD9'}
            onPress={() => onSelect?.(s.id)}
          />
        ))}
        {sel && arrowTo ? (
          <>
            <Polyline
              coordinates={[
                { latitude: sel.latitude, longitude: sel.longitude },
                { latitude: arrowTo.latitude, longitude: arrowTo.longitude },
              ]}
              strokeColor="#D93B3B"
              strokeWidth={5}
              lineDashPattern={[12, 8]}
            />
            <Marker
              coordinate={{ latitude: arrowTo.latitude, longitude: arrowTo.longitude }}
              title="다음 정류장 (진행 방향)"
              pinColor="#F2994A"
            />
          </>
        ) : null}
      </MapView>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { borderRadius: 14, overflow: 'hidden', backgroundColor: '#e8ecf2' },
});
