// 1) 치명적 JS 오류 표시 2) 백그라운드 태스크 정의(전역 스코프 필수) 3) 앱 UI 순서로 로드한다.
import './src/services/crashGuard';
import './src/services/background';
import 'expo-router/entry';
