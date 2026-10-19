/** 雷達和地圖上固定顯示的地標（畫成星星），不算進清單和摘要 */
export interface Landmark {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export const LANDMARKS: Landmark[] = [
  // 北平東路與林森北路的路口（OSM 交叉點），民進黨中央黨部在東邊約 200 m
  { id: 'hq', name: '洋流總部', address: '台北市北平東路與林森北路交叉口（鄰近民進黨中央黨部旁）', lat: 25.0463, lng: 121.5238 },
];
