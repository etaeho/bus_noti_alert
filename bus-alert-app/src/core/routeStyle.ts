/**
 * 노선 종류별 색상 (서울시 버스 색상 체계 기준, 다른 지역도 비슷한 의미로 매핑)
 */
export interface RouteStyle {
  color: string;
  label: string;
}

const STYLES: { match: RegExp; color: string; label: string }[] = [
  { match: /광역|직행|급행|고속|시외|M버스/, color: '#E0322B', label: '광역·급행' },
  { match: /공항/, color: '#00A0DE', label: '공항' },
  { match: /순환/, color: '#E8A400', label: '순환' },
  { match: /마을|따복|농어촌/, color: '#3FA535', label: '마을' },
  { match: /지선|외곽/, color: '#4CAF3E', label: '지선' },
  { match: /간선/, color: '#2F5DBA', label: '간선' },
  { match: /좌석/, color: '#8A4FC7', label: '좌석' },
];

export function routeStyle(routeType: string | undefined, routeNo: string): RouteStyle {
  const t = (routeType ?? '').trim();
  for (const s of STYLES) if (s.match.test(t)) return { color: s.color, label: t || s.label };
  // 종류 정보가 없을 때 번호로 추정
  if (/^M\d/i.test(routeNo) || /^9\d{3}$/.test(routeNo)) return { color: '#E0322B', label: t || '광역' };
  if (/마을/.test(routeNo)) return { color: '#3FA535', label: t || '마을' };
  return { color: '#2F5DBA', label: t || '시내' };
}
