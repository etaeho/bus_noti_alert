// app.json 을 기본으로, 빌드 시 환경변수로 받은 Google 지도 키를 주입한다.
// 키가 없으면 앱은 키가 필요 없는 기본 지도(OpenStreetMap/CARTO)를 사용한다.
//   GitHub Actions: 저장소 Secrets 의 GOOGLE_MAPS_API_KEY
module.exports = ({ config }) => {
  const key = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
  const plugins = [...(config.plugins || [])];
  if (key) plugins.push(['react-native-maps', { androidGoogleMapsApiKey: key }]);
  return {
    ...config,
    plugins,
    extra: { ...(config.extra || {}), googleMapsEnabled: Boolean(key) },
  };
};
