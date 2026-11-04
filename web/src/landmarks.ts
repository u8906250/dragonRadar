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
