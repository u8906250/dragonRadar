/** 雷達和地圖上固定顯示的地標（畫成星星），不算進清單和摘要 */
export interface Landmark {
  id: string;
  name: string;
  /** 說明，顯示在詳細資料和地圖上 */
  about: string;
  address: string;
  lat: number;
  lng: number;
  /** 官方網站 */
  url: string;
  urlName: string;
}

export const LANDMARKS: Landmark[] = [
  {
    id: 'hq',
    name: '洋流總部',
    about: '台北大洋流的總部，在北平東路、林森北路口附近，民進黨中央黨部旁。最新行程、車掃與活動以官網公告為準。',
    address: '臺北市中正區北平東路30-1號1樓',
    // OSM 門牌「北平東路30之1號」
    lat: 25.0456,
    lng: 121.5263,
    url: 'https://current.puma.taipei/',
    urlName: '台北大洋流官網',
  },
];

/**
 * 點了洋流總部的特效（main.ts 的 startHqVoyage）：洋流號從總部像一道海流流過台北市 12 個區（每區一個大家認得的地方），
 * 最後流進台北市政府，到了放煙火。地點的經緯度照 OpenStreetMap（Nominatim 查的）；© OpenStreetMap contributors
 */
export const HQ_TOUR: Array<{ district: string; place: string; lat: number; lng: number }> = [
  { district: '中正區', place: '洋流總部', lat: 25.0456, lng: 121.5263 },
  { district: '萬華區', place: '艋舺龍山寺', lat: 25.03725, lng: 121.49988 },
  { district: '大同區', place: '大稻埕', lat: 25.05687, lng: 121.51125 },
  { district: '中山區', place: '花博公園', lat: 25.06856, lng: 121.52088 },
  { district: '士林區', place: '士林夜市', lat: 25.08835, lng: 121.5251 },
  { district: '北投區', place: '北投公園', lat: 25.13654, lng: 121.50613 },
  { district: '內湖區', place: '大湖公園', lat: 25.08376, lng: 121.60234 },
  { district: '南港區', place: '南港展覽館', lat: 25.05538, lng: 121.6179 },
  { district: '松山區', place: '饒河街夜市', lat: 25.05043, lng: 121.57145 },
  { district: '文山區', place: '臺北市立動物園', lat: 24.99535, lng: 121.58615 },
  { district: '大安區', place: '大安森林公園', lat: 25.02969, lng: 121.53582 },
  // 終點：市政府建築的中間（CITY_HALL_OUTLINE 圍起來的）
  { district: '信義區', place: '臺北市政府', lat: 25.03751, lng: 121.56438 },
];

/** 台北市政府的外框（OpenStreetMap way 142113976，簡化到約 1 公尺），[緯度, 經度]：播放時在終點用虛線畫出來 */
export const CITY_HALL_OUTLINE: Array<[number, number]> = [
  [25.036487, 121.564635], [25.036491, 121.564401], [25.036526, 121.564402], [25.036526, 121.564383], [25.036312, 121.564379], [25.036314, 121.564292],
  [25.036528, 121.564297], [25.036528, 121.564264], [25.036558, 121.564264], [25.036564, 121.563902], [25.036704, 121.563905], [25.036703, 121.563978],
  [25.037062, 121.563985], [25.037098, 121.563986], [25.037099, 121.563883], [25.037174, 121.563885], [25.037174, 121.563914], [25.037305, 121.563917],
  [25.0373, 121.564194], [25.037354, 121.564195], [25.037362, 121.563746], [25.037696, 121.563753], [25.037688, 121.564202], [25.037741, 121.564203],
  [25.037746, 121.563926], [25.03788, 121.563929], [25.037881, 121.563899], [25.037955, 121.563901], [25.037953, 121.564003], [25.037988, 121.564004],
  [25.038346, 121.564011], [25.038347, 121.563938], [25.038489, 121.563941], [25.038483, 121.564303], [25.038512, 121.564304], [25.038512, 121.564337],
  [25.038723, 121.564341], [25.038722, 121.564428], [25.03851, 121.564424], [25.03851, 121.564442], [25.038543, 121.564443], [25.038539, 121.564677],
  [25.037942, 121.564665], [25.037933, 121.565195], [25.037858, 121.565193], [25.037858, 121.565163], [25.037725, 121.56516], [25.037733, 121.564682],
  [25.03768, 121.56468], [25.037672, 121.565155], [25.037339, 121.565149], [25.037346, 121.564674], [25.037292, 121.564673], [25.037284, 121.565151],
  [25.037153, 121.565149], [25.037153, 121.565179], [25.037078, 121.565177], [25.037087, 121.564647],
];

/**
 * 海流：照 HQ_TOUR 的順序，用圓滑的曲線（向心 Catmull-Rom）一站一站流過去，大約每 120 公尺一點，[緯度, 經度]；
 * HQ_TOUR_AT 是每一站在整條線上走到幾成（0～1，經過時寫區名）
 */
export const HQ_VOYAGE: Array<[number, number]> = [];
export const HQ_TOUR_AT: number[] = [];
{
  const KX = 111_320 * Math.cos((25.06 * Math.PI) / 180);
  const KY = 110_574;
  const P = HQ_TOUR.map((s) => [s.lng * KX, s.lat * KY] as const);
  const at = (i: number): readonly [number, number] => P[Math.max(0, Math.min(P.length - 1, i))];
  const dist = (a: readonly [number, number], b: readonly [number, number]): number => Math.max(1e-6, Math.hypot(a[0] - b[0], a[1] - b[1]) ** 0.5);
  const lens: number[] = [0];
  HQ_TOUR_AT[0] = 0;
  for (let i = 0; i + 1 < P.length; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const [t1, t2] = [dist(p0, p1), dist(p1, p2)];
    const t3 = dist(p2, p3);
    const n = Math.max(6, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 120));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      // 向心 Catmull-Rom（Barry–Goldman）：t 在 [0, t2] 之間
      const t = (k / n) * t2;
      const lerp = (a: readonly [number, number], b: readonly [number, number], ta: number, tb: number, tt: number): [number, number] => {
        const w = (tt - ta) / (tb - ta);
        return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
      };
      const A1 = lerp(p0, p1, -t1, 0, t);
      const A2 = lerp(p1, p2, 0, t2, t);
      const A3 = lerp(p2, p3, t2, t2 + t3, t);
      const B1 = lerp(A1, A2, -t1, t2, t);
      const B2 = lerp(A2, A3, 0, t2 + t3, t);
      const C = lerp(B1, B2, 0, t2, t);
      if (HQ_VOYAGE.length) {
        const [py, px] = HQ_VOYAGE[HQ_VOYAGE.length - 1];
        lens.push(lens[lens.length - 1] + Math.hypot(C[0] - px * KX, C[1] - py * KY));
      }
      HQ_VOYAGE.push([C[1] / KY, C[0] / KX]);
    }
    HQ_TOUR_AT[i + 1] = lens.length - 1;
  }
  const total = lens[lens.length - 1];
  for (let i = 0; i < HQ_TOUR_AT.length; i++) HQ_TOUR_AT[i] = lens[HQ_TOUR_AT[i]] / total;
}
