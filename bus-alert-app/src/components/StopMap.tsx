/**
 * 정류장 지도 (WebView + Leaflet, CARTO 지도 타일 - API 키 불필요)
 *  - 정류장 마커 표시 / 탭하면 onSelect
 *  - 선택한 정류장 → 다음 정류장 화살표로 진행 방향 표시
 *  - 지도를 움직이면 onMoved(중심 좌표)
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ComponentType, type Ref } from 'react';
import Constants from 'expo-constants';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';

// react-native-webview 의 클래스 컴포넌트 타입이 React 19 타입과 맞지 않아 명시적으로 지정
const MapWebView = WebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebView> }>;

export interface MapStop {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
}

export interface StopMapProps {
  stops: MapStop[];
  selectedId?: string | null;
  me?: { latitude: number; longitude: number } | null;
  /** 선택 정류장에서 다음 정류장 방향 화살표 */
  arrowTo?: { latitude: number; longitude: number } | null;
  onSelect?: (id: string) => void;
  onMoved?: (center: { latitude: number; longitude: number }) => void;
  height?: number;
  /** 모서리 둥글림 없이 (전체 화면 지도) */
  flat?: boolean;
  /** 아래쪽이 시트로 가려지는 높이(px) - 선택 정류장을 보이는 영역 가운데에 */
  bottomInset?: number;
}

export interface StopMapHandle {
  /** 현재 지도 중심 */
  getCenter(): { latitude: number; longitude: number } | null;
  focus(latitude: number, longitude: number, zoom?: number): void;
}

const HTML = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
 html,body,#map{margin:0;height:100%;background:#e8ecf2}
 .lbl{background:#fff;border:1px solid #2563EB;border-radius:8px;padding:2px 6px;font:700 12px sans-serif;color:#111827;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.25);cursor:pointer}
 .lbl.sel{background:#D93B3B;border-color:#D93B3B;color:#fff}
 .leaflet-tooltip.lbl:before{display:none}
 .arrow{font-size:22px;color:#D93B3B;line-height:22px;text-align:center;text-shadow:0 0 3px #fff}
 .me{width:14px;height:14px;border-radius:7px;background:#1E6FD9;border:3px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.4)}
</style></head><body><div id="map"></div><script>
var post=function(o){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(o))};
var map=L.map('map',{zoomControl:true,attributionControl:true}).setView([36.35,127.38],16);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',{maxZoom:19,subdomains:'abcd',attribution:'&copy; OpenStreetMap &copy; CARTO'}).addTo(map);
var layer=L.layerGroup().addTo(map), meLayer=L.layerGroup().addTo(map), arrowLayer=L.layerGroup().addTo(map);
var lastKey='';var inset=0;
map.on('moveend',function(){var c=map.getCenter();post({type:'moved',lat:c.lat,lng:c.lng})});
function bearing(a,b){var t=Math.PI/180,y=Math.sin((b[1]-a[1])*t)*Math.cos(b[0]*t),x=Math.cos(a[0]*t)*Math.sin(b[0]*t)-Math.sin(a[0]*t)*Math.cos(b[0]*t)*Math.cos((b[1]-a[1])*t);return Math.atan2(y,x)/t}
window.setData=function(d){
  inset=d.inset||0;
  layer.clearLayers();arrowLayer.clearLayers();meLayer.clearLayers();
  var pts=[];
  (d.stops||[]).forEach(function(s){
    var sel=s.id===d.selectedId;
    var m=L.circleMarker([s.latitude,s.longitude],{radius:sel?12:9,color:'#fff',weight:3,fillColor:sel?'#D93B3B':'#2563EB',fillOpacity:1}).addTo(layer);
    var pick=function(){post({type:'select',id:s.id})};
    m.bindTooltip(s.label,{permanent:true,interactive:true,direction:'top',offset:[0,-10],className:'lbl'+(sel?' sel':'')});
    m.on('click',pick);
    var tip=m.getTooltip(); if(tip&&tip.on){tip.on('click',pick)}
    pts.push([s.latitude,s.longitude]);
  });
  if(d.me){L.marker([d.me.latitude,d.me.longitude],{icon:L.divIcon({className:'',html:'<div class="me"></div>',iconSize:[20,20],iconAnchor:[10,10]}),interactive:false}).addTo(meLayer)}
  var sel=(d.stops||[]).filter(function(s){return s.id===d.selectedId})[0];
  if(sel&&d.arrowTo){
    var a=[sel.latitude,sel.longitude],b=[d.arrowTo.latitude,d.arrowTo.longitude];
    L.polyline([a,b],{color:'#D93B3B',weight:4,dashArray:'6 6'}).addTo(arrowLayer);
    var deg=bearing(a,b);
    L.marker(b,{icon:L.divIcon({className:'',html:'<div class="arrow" style="transform:rotate('+(deg-90)+'deg)">&#10148;</div>',iconSize:[22,22],iconAnchor:[11,11]}),interactive:false}).addTo(arrowLayer);
    pts.push(b);
  }
  var key=JSON.stringify(pts)+'|'+d.selectedId;
  if(d.fit&&key!==lastKey){
    if(sel&&d.arrowTo){map.fitBounds(L.latLngBounds([[sel.latitude,sel.longitude],[d.arrowTo.latitude,d.arrowTo.longitude]]).pad(0.6),{maxZoom:18,paddingBottomRight:[0,inset]})}
    else if(sel){map.setView([sel.latitude,sel.longitude],17,{animate:false});if(inset)map.panBy([0,inset/2],{animate:false})}
    else if(d.me&&pts.length){
      // 현재 위치 기준으로 가장 가까운 정류장들만 보이게 가깝게 확대
      var near=pts.slice().sort(function(a,b){return map.distance(a,[d.me.latitude,d.me.longitude])-map.distance(b,[d.me.latitude,d.me.longitude])}).slice(0,6);
      near.push([d.me.latitude,d.me.longitude]);
      map.fitBounds(L.latLngBounds(near).pad(0.15),{maxZoom:18,paddingBottomRight:[0,inset]});
    }
    else if(pts.length>1){map.fitBounds(L.latLngBounds(pts).pad(0.1),{maxZoom:18})}
    else if(pts.length===1){map.setView(pts[0],17)}
    else if(d.me){map.setView([d.me.latitude,d.me.longitude],17)}
  }
  lastKey=key;
};
window.focusTo=function(lat,lng,z){map.setView([lat,lng],z||16,{animate:false});if(inset)map.panBy([0,inset/2],{animate:false})};
post({type:'ready'});
</script></body></html>`;

const LeafletStopMap = forwardRef<StopMapHandle, StopMapProps>(function LeafletStopMap(
  { stops, selectedId, me, arrowTo, onSelect, onMoved, height = 300, flat, bottomInset = 0 },
  ref,
) {
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const center = useRef<{ latitude: number; longitude: number } | null>(null);

  useImperativeHandle(ref, () => ({
    getCenter: () => center.current,
    focus: (lat, lng, zoom) => web.current?.injectJavaScript(`window.focusTo(${lat},${lng},${zoom ?? 16});true;`),
  }));

  useEffect(() => {
    if (!ready) return;
    const payload = JSON.stringify({ stops, selectedId: selectedId ?? null, me: me ?? null, arrowTo: arrowTo ?? null, fit: true, inset: bottomInset });
    web.current?.injectJavaScript(`window.setData(${payload});true;`);
  }, [ready, stops, selectedId, me, arrowTo, bottomInset]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'ready') setReady(true);
      else if (msg.type === 'select') onSelect?.(String(msg.id));
      else if (msg.type === 'moved') {
        center.current = { latitude: msg.lat, longitude: msg.lng };
        onMoved?.(center.current);
      }
    } catch {
      // 무시
    }
  };

  return (
    <View style={[styles.wrap, { height }, flat && { borderRadius: 0 }]}>
      <MapWebView
        ref={web}
        originWhitelist={['*']}
        source={{ html: HTML, baseUrl: 'https://localhost/' }}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        nestedScrollEnabled
        style={styles.web}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { borderRadius: 14, overflow: 'hidden', backgroundColor: '#e8ecf2' },
  web: { flex: 1, backgroundColor: 'transparent' },
});

/**
 * 빌드에 Google 지도 키가 들어 있으면 Google 지도, 없으면 키가 필요 없는 기본 지도.
 * (GoogleStopMap 은 키가 있을 때만 불러온다 - 키 없이 Google 지도를 띄우면 앱이 종료됨)
 */
const googleMapsEnabled = Boolean(
  (Constants.expoConfig?.extra as { googleMapsEnabled?: boolean } | undefined)?.googleMapsEnabled,
);

export const StopMap: typeof LeafletStopMap = googleMapsEnabled
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./GoogleStopMap') as typeof import('./GoogleStopMap')).GoogleStopMap
  : LeafletStopMap;
