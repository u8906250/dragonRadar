/**
 * 漂流瓶：在自己附近的牛皮紙上寫一段話（字數比照 X：中文 140 字、英文 280 字），捲起來裝進瓶子丟出去，別人走到 500 m 內才撿得起來、看得到內容。
 * v1.593 改版（使用者的想法：只在丟的地方附近漂、24 小時後漂到汪星的海上、每天最多三個、獨一無二的編號、做好直接開放）：
 *
 * - 不用登入：前端第一次用時產生隨機的裝置代碼，放在 x-device 標頭；伺服器只存加鹽雜湊。
 * - 隱私：丟的位置先打散到約 100 m 內再存，不存真正的位置（不會因為在家丟瓶子就洩漏住址）。
 * - 內容：先用規則擋掉連結、電話、帳號，再交給 AI 擋攻擊性內容、廣告、個資（不要求一定正向）；AI 失敗就不收。
 * - 一個瓶子只能被一個人撿走，撿走就從雷達上消失、收進撿到的人的「瓶中信收藏」；撿到的人可以檢舉，檢舉就藏起來等管理者確認。
 * - 漂流：丟下的 24 小時內，每 2 小時在丟的地方附近（200 m 內）晃一下；沒人撿就漂到汪星的海上（world = 'woof'，
 *   lat、lng 換成汪星的經緯度，woofsea.ts），跟丟的地方同一個方向的海邊；在汪星的海上留 30 天，沒人撿就沉下去。
 *   汪星上的「你的位置」是雷達正中間（搭火箭過去，拖曳就是走路），一樣要 500 m 內才撿得到。
 * - 編號：瓶子的流水號就是編號（前端寫成 No.000123）；瓶子證明（bottleProof）＝編號、丟的時間、內容的 SHA-256，伺服器簽章，之後可以驗證。
 * - 每天最多丟 3 個（以前回收撿到的瓶子多一個，拿掉了）。
 * - 照片（v1.594）：可以附一張。瀏覽器先縮小、重新存成 JPEG，伺服器再拿掉 JPEG 裡的 EXIF（GPS 等）、交給 AI 看圖審核，
 *   存在 R2（BOTTLE_PHOTOS），只有丟的人和撿到的人拿得到；瓶子刪掉時一起刪。
 * - BOTTLES_ENABLED = "false" 可以整個關掉。
 */
import type { Env } from './env';
import { responseContent } from './extract';
import { hashSalt, ReportError } from './reports';
import { sha1Hex } from './sources/text';
import { TAIPEI_CENTER, WOOF_KM, WOOF_SEA } from './woofsea';

/** 字數比照 X（Twitter）：上限 280，拉丁字母、數字、一般標點算 1，其他（中文、全形、表情）算 2 */
export const BOTTLE_MAX_WEIGHT = 280;

const lightChar = (cp: number): boolean =>
  cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037);

/** X 的字數算法（跟 web/src/xcount.ts 同一套）：一整個表情組合算一個字 */
export function xLength(text: string): number {
  const segs = Array.from(new Intl.Segmenter('zh-Hant', { granularity: 'grapheme' }).segment(text.normalize('NFC')), (s) => s.segment);
  let n = 0;
  for (const g of segs) {
    const cps = Array.from(g);
    n += cps.length === 1 && lightChar(cps[0].codePointAt(0) ?? 0) ? 1 : 2;
  }
  return n;
}
/** 在丟的地方附近漂多久，之後漂到汪星的海上 */
export const SEA_AFTER_SEC = 86400;
/** 在汪星的海上留多久，沒人撿就沉下去 */
export const WOOF_STAY_SEC = 30 * 86400;
/** 瓶子整個的壽命：地球 1 天＋汪星 30 天 */
export const BOTTLE_TTL_SEC = SEA_AFTER_SEC + WOOF_STAY_SEC;
/** 走到這個距離內才撿得起來 */
/** v1.599 使用者說改成 500 m 內可以撿（以前 60 m） */
export const PICK_RADIUS_M = 500;
/** 丟的位置打散的範圍 */
const SCATTER_M = 100;
/** 每天最多丟幾個（過去 24 小時）；總量另外由同 IP 每天、全站每小時的上限擋 */
export const PER_DEVICE_PER_DAY = 3;
const PER_IP_PER_DAY = 20;
const GLOBAL_PER_HOUR = 120;
const LIST_LIMIT = 200;
/** 汪星海上的瓶子一次全部給 */
const WOOF_LIST_LIMIT = 500;
/** 一個裝置最多收藏幾封信 */
const MAX_LETTERS = 500;

/** 在丟的地方附近漂：多久晃一次、一次最多晃多遠、離丟下的地方（已打散）最多多遠 */
export const DRIFT_EVERY_SEC = 2 * 3600;
const DRIFT_STEP_M = 60;
const DRIFT_RANGE_M = 200;
/** 漂到汪星的海上：在海邊那一點附近散開多遠（woofsea.ts 的點周圍 350 m 都是海） */
const SEA_SCATTER_M = 250;

/** active 漂流中、picked 被撿走了、hidden 被檢舉藏起來、deleted 丟的人收回或沉下去、removed 管理者移除 */
export type BottleStatus = 'active' | 'picked' | 'hidden' | 'deleted' | 'removed';
/** earth 在地球（丟的地方附近）、woof 漂到汪星的海上（lat、lng 是汪星的經緯度） */
export type BottleWorld = 'earth' | 'woof';

interface BottleRow {
  id: number;
  device_id: string;
  text: string;
  lat: number;
  lng: number;
  status: BottleStatus;
  picks: number;
  reports: number;
  ip_hash: string | null;
  created_at: number;
  expires_at: number;
  origin_lat: number | null;
  origin_lng: number | null;
  drifted_at: number | null;
  world: BottleWorld;
  sea_at: number | null;
  photo_key: string | null;
}

/** 雷達上的瓶子：沒撿起來前看不到內容 */
export interface BottleOut {
  /** 也是瓶子的編號（No.000123） */
  id: number;
  world: BottleWorld;
  lat: number;
  lng: number;
  createdAt: number;
  expiresAt: number;
  /** 自己丟的 */
  mine: boolean;
  /** 自己撿過了 */
  picked: boolean;
  /** 被撿起來的次數 */
  picks: number;
}

// ---- 照片 ----
/** 照片最大幾個位元組（瀏覽器縮到長邊 1280、JPEG 品質 0.8 約 150–400 KB） */
export const PHOTO_MAX_BYTES = 700_000;
const PHOTO_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
export const photosEnabled = (env: Env): boolean => !!env.BOTTLE_PHOTOS;

/** 送上來的照片：data:image/jpeg;base64,…；沒放是 null，格式不對、太大丟錯誤 */
export function parsePhoto(v: unknown): { bytes: Uint8Array; dataUrl: string } | null {
  if (v === undefined || v === null || v === '') return null;
  const m = typeof v === 'string' ? /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(v) : null;
  if (!m) throw new ReportError(400, '照片格式不對，請重新選一張');
  const bin = atob(m[1]);
  if (bin.length > PHOTO_MAX_BYTES) throw new ReportError(413, '照片太大了，請換一張');
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new ReportError(400, '照片格式不對，請重新選一張');
  return { bytes, dataUrl: v as string };
}

/**
 * 拿掉 JPEG 裡的中繼資料：APP1～APP15（EXIF 的 GPS、相機、拍攝時間，XMP…）和註解（COM），影像本身不動。
 * 瀏覽器重新存檔時就沒有了，這裡再擋一次（不是從網頁送來的也一樣）。看不懂的格式丟錯誤
 */
export function stripJpegMeta(b: Uint8Array): Uint8Array {
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new ReportError(400, '照片格式不對，請重新選一張');
    const marker = b[i + 1];
    // 填充用的 0xFF
    if (marker === 0xff) {
      i++;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) throw new ReportError(400, '照片格式不對，請重新選一張');
    // 開始掃描（SOS）：後面都是影像資料，整段照抄
    if (marker === 0xda) {
      for (let k = i; k < b.length; k++) out.push(b[k]);
      return Uint8Array.from(out);
    }
    const drop = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!drop) for (let k = i; k < i + 2 + len; k++) out.push(b[k]);
    i += 2 + len;
  }
  throw new ReportError(400, '照片格式不對，請重新選一張');
}

const PHOTO_PROMPT = `你是「洋流雷達」漂流瓶照片的審核員。漂流瓶是使用者留給路過陌生人的一段話，可以附一張照片（台北大洋流競選活動的網站上）。
風景、街景、食物、寵物、活動現場、自拍、合照都可以。

只擋下這幾類：
- 色情、裸露、性暗示
- 暴力、血腥、自殘、令人不舒服的畫面
- 個人資料：證件、文件、信封或螢幕上看得清楚的姓名、地址、電話、帳號；看得清楚的車牌、門牌號碼；QR code
- 廣告、商品推銷、價目表
- 攻擊、嘲諷、抹黑任何人或團體（包括候選人、政黨）的圖文

只輸出 JSON：{"allowed": true 或 false, "reason": "不允許時用一句話說明是哪一類，給使用者看；允許時空字串"}`;

/** AI 看圖審核；AI 失敗就不收（寧可不收） */
async function moderatePhoto(env: Env, dataUrl: string): Promise<{ allowed: boolean; reason: string }> {
  const ai = env.AI as unknown as { run(model: string, inputs: unknown): Promise<unknown> };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await ai.run(PHOTO_MODEL, {
        messages: [{ role: 'user', content: [{ type: 'text', text: PHOTO_PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }] }],
        max_tokens: 200,
        temperature: 0,
      });
      const c = responseContent(res);
      const o = (typeof c === 'string' ? JSON.parse(c.replace(/^[^{]*/, '').replace(/[^}]*$/, '')) : c) as { allowed?: unknown; reason?: unknown };
      if (typeof o?.allowed === 'boolean') return { allowed: o.allowed, reason: typeof o.reason === 'string' ? o.reason.slice(0, 80) : '' };
    } catch (e) {
      console.warn(`bottle photo moderation failed: ${String(e)}`);
    }
  }
  throw new ReportError(503, '照片暫時沒辦法審核，請稍後再丟，或先不放照片');
}

/** 看照片：丟的人、撿到的人才拿得到（看得到內容的人）；被檢舉藏起來、被移除的不給 */
export async function bottlePhoto(env: Env, device: string | null, id: number): Promise<Response> {
  const dev = needDevice(device);
  const b = await env.DB.prepare("SELECT device_id, photo_key FROM bottles WHERE id = ? AND status IN ('active', 'picked')").bind(id).first<{ device_id: string; photo_key: string | null }>();
  if (!b?.photo_key || !env.BOTTLE_PHOTOS) throw new ReportError(404, '這個瓶子沒有照片');
  if (b.device_id !== dev && !(await env.DB.prepare('SELECT 1 AS x FROM bottle_picks WHERE bottle_id = ? AND device_id = ?').bind(id, dev).first()))
    throw new ReportError(403, '撿到瓶子才看得到照片');
  const obj = await env.BOTTLE_PHOTOS.get(b.photo_key);
  if (!obj) throw new ReportError(404, '這個瓶子沒有照片');
  return new Response(obj.body, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400' } });
}

export const bottlesEnabled = (env: Env): boolean => env.BOTTLES_ENABLED !== 'false';

/** 裝置代碼（前端產生的隨機字串）換成雜湊；沒有或格式不對就是 null */
export async function deviceId(env: Env, req: Request): Promise<string | null> {
  const raw = req.headers.get('x-device') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(raw)) return null;
  return sha1Hex(`device|${raw}|${await hashSalt(env)}`, 24);
}

function needDevice(id: string | null): string {
  if (!id) throw new ReportError(400, '缺少裝置代碼，請重新整理頁面');
  return id;
}

/** 球面上兩點的距離（公尺）；radiusM 預設地球，汪星用 WOOF_M */
export function distM(a: { lat: number; lng: number }, b: { lat: number; lng: number }, radiusM = 6371000): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * radiusM * Math.asin(Math.min(1, Math.sqrt(s)));
}
/** 汪星的半徑（公尺） */
const WOOF_M = WOOF_KM * 1000;
/** 汪星每度緯度幾公尺 */
const WOOF_M_PER_DEG = (WOOF_M * Math.PI) / 180;

/** 往東 dx、往北 dy 公尺，四捨五入到 1e-5 度（地球約 1 m）；perDeg 是每度緯度幾公尺（汪星用 WOOF_M_PER_DEG） */
function offset(p: { lat: number; lng: number }, dx: number, dy: number, perDeg = 111320): { lat: number; lng: number } {
  const dLat = dy / perDeg;
  const dLng = dx / (perDeg * Math.cos((p.lat * Math.PI) / 180));
  return { lat: Math.round((p.lat + dLat) * 1e5) / 1e5, lng: Math.round((p.lng + dLng) * 1e5) / 1e5 };
}

/** 在地球上從丟下的地方漂了幾公尺（舊資料沒有起點、漂到汪星的是 0） */
const driftOf = (b: { lat: number; lng: number; origin_lat: number | null; origin_lng: number | null; world: BottleWorld }): number =>
  b.world !== 'earth' || b.origin_lat === null || b.origin_lng === null ? 0 : Math.round(distM({ lat: b.origin_lat, lng: b.origin_lng }, b));

/**
 * 在丟的地方附近晃一步：隨機往一個方向晃 DRIFT_STEP_M 內；晃出丟下的地方（已打散）DRIFT_RANGE_M 外就改成往回漂一步。
 * 沒有起點（舊資料）就當作現在的位置是起點。
 */
export function driftStep(
  p: { lat: number; lng: number; origin_lat: number | null; origin_lng: number | null },
  rand: () => number = Math.random,
): { lat: number; lng: number } {
  const home = p.origin_lat === null || p.origin_lng === null ? p : { lat: p.origin_lat, lng: p.origin_lng };
  const r = DRIFT_STEP_M * Math.sqrt(rand());
  const a = 2 * Math.PI * rand();
  const to = offset(p, r * Math.sin(a), r * Math.cos(a));
  if (distM(home, to) <= DRIFT_RANGE_M) return to;
  // 往回：朝起點走一步（平面近似）
  const ux = (home.lng - p.lng) * 111320 * Math.cos((p.lat * Math.PI) / 180);
  const uy = (home.lat - p.lat) * 111320;
  const len = Math.hypot(ux, uy) || 1;
  const step = Math.min(DRIFT_STEP_M, len);
  return offset(p, (ux / len) * step, (uy / len) * step);
}

/** 從台北市的中心看，這個地方在哪個方向（度，0 是北、順時針） */
function bearingFromTaipei(p: { lat: number; lng: number }): number {
  const dx = (p.lng - TAIPEI_CENTER.lng) * Math.cos((TAIPEI_CENTER.lat * Math.PI) / 180);
  const dy = p.lat - TAIPEI_CENTER.lat;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/**
 * 漂到汪星的海上：汪星的陸地是台北市，瓶子漂到跟丟的地方同一個方向（從台北市的中心看）的海邊，
 * 在最接近的 3 個海邊點裡隨機挑一個，再散開 SEA_SCATTER_M 內。回傳汪星的經緯度
 */
export function seaPoint(from: { lat: number; lng: number } | null, rand: () => number = Math.random): { lat: number; lng: number } {
  let pick: readonly [number, number, number];
  if (from) {
    const b = bearingFromTaipei(from);
    const gap = (x: number): number => Math.abs((((x - b) % 360) + 540) % 360 - 180);
    const best = [...WOOF_SEA].sort((x, y) => gap(x[2]) - gap(y[2])).slice(0, 3);
    pick = best[Math.min(best.length - 1, Math.floor(rand() * best.length))];
  } else {
    pick = WOOF_SEA[Math.min(WOOF_SEA.length - 1, Math.floor(rand() * WOOF_SEA.length))];
  }
  const r = SEA_SCATTER_M * Math.sqrt(rand());
  const a = 2 * Math.PI * rand();
  return offset({ lat: pick[0], lng: pick[1] }, r * Math.sin(a), r * Math.cos(a), WOOF_M_PER_DEG);
}

/**
 * 排程每次跑：丟下滿 24 小時沒人撿的漂到汪星的海上；其他還在地球上的，每 DRIFT_EVERY_SEC 在丟的地方附近晃一步。
 * 汪星上的瓶子不動。回傳漂了幾個
 */
export async function driftBottles(env: Env, now: number, rand: () => number = Math.random): Promise<{ moved: number; toSea: number }> {
  const { results } = await env.DB.prepare(
    "SELECT id, lat, lng, origin_lat, origin_lng, created_at FROM bottles WHERE status = 'active' AND world = 'earth' AND expires_at > ? AND (created_at <= ? OR COALESCE(drifted_at, created_at) < ?) LIMIT 300",
  )
    .bind(now, now - SEA_AFTER_SEC, now - DRIFT_EVERY_SEC)
    .all<{ id: number; lat: number; lng: number; origin_lat: number | null; origin_lng: number | null; created_at: number }>();
  if (results.length === 0) return { moved: 0, toSea: 0 };
  let toSea = 0;
  const stmts = results.map((b) => {
    if (b.created_at <= now - SEA_AFTER_SEC) {
      toSea++;
      const p = seaPoint(b.origin_lat === null || b.origin_lng === null ? b : { lat: b.origin_lat, lng: b.origin_lng }, rand);
      // 被撿走、被檢舉的不動（狀態不是 active 就不改）
      return env.DB.prepare("UPDATE bottles SET world = 'woof', lat = ?, lng = ?, sea_at = ?, drifted_at = ? WHERE id = ? AND status = 'active' AND world = 'earth'").bind(
        p.lat,
        p.lng,
        now,
        now,
        b.id,
      );
    }
    const to = driftStep(b, rand);
    return env.DB.prepare("UPDATE bottles SET lat = ?, lng = ?, drifted_at = ? WHERE id = ? AND status = 'active' AND world = 'earth'").bind(to.lat, to.lng, now, b.id);
  });
  await env.DB.batch(stmts);
  return { moved: results.length - toSea, toSea };
}

/** 把位置隨機移到 SCATTER_M 內（均勻分布在圓內） */
export function scatter(p: { lat: number; lng: number }, rand: () => number = Math.random): { lat: number; lng: number } {
  const r = SCATTER_M * Math.sqrt(rand());
  const t = 2 * Math.PI * rand();
  return offset(p, r * Math.sin(t), r * Math.cos(t));
}

/** 規則先擋：連結、電話、Email、LINE／IG 帳號、太長的數字、全是符號 */
export function ruleCheck(text: string): string | null {
  const t = text.trim();
  if (!t) return '寫點什麼再丟吧';
  if (xLength(t) > BOTTLE_MAX_WEIGHT) return '太長了：字數比照 X，中文最多 140 字、英文最多 280 字';
  if (/[\w.+-]+@[\w-]+\.\w+/.test(t)) return '不能放 Email';
  if (/https?:\/\/|www\.|\.(com|net|tw|org|io|cc|me)\b/i.test(t)) return '不能放連結';
  if (/(?:\d[\s-]?){7,}/.test(t)) return '不能放電話或一長串數字';
  if (/(line|ig|instagram|tg|telegram|wechat|微信)\s*(id)?\s*[:：@]/i.test(t) || /@[A-Za-z0-9_.]{3,}/.test(t)) return '不能放帳號';
  if (!/[\p{L}\p{N}]/u.test(t)) return '寫點文字再丟吧';
  return null;
}

const MODERATION_PROMPT = `你是「洋流雷達」漂流瓶的內容審核員。漂流瓶是使用者在街頭留給路過陌生人的一句話（台北大洋流競選活動的網站上）。
內容不一定要正向：打氣、感謝、心情、抱怨、日常小事、在地觀察、對城市的期待都可以。

只擋下這幾類：
- 攻擊性內容：辱罵、嘲諷、貶低、人身攻擊任何人或團體（包括候選人、政黨、政府、媒體、網友），抹黑、未經證實的指控或謠言
- 仇恨、歧視、威脅、暴力、色情
- 廣告、推銷、拉客、抽獎、要別人做事換東西
- 聯絡方式或個人資料：電話、帳號、住址、某個具體個人的私事或行蹤

只輸出 JSON：{"allowed": true 或 false, "reason": "不允許時用一句話說明是哪一類，給使用者看；允許時空字串"}`;

/** AI 判斷有沒有攻擊性、廣告、個資；AI 失敗就當成不通過（寧可不收） */
async function moderate(env: Env, text: string): Promise<{ allowed: boolean; reason: string }> {
  const ai = env.AI as unknown as { run(model: string, inputs: unknown): Promise<unknown> };
  const messages = [
    { role: 'system', content: MODERATION_PROMPT },
    { role: 'user', content: `漂流瓶內容：「${text}」${/qwen3/i.test(env.AI_MODEL) ? '\n/no_think' : ''}` },
  ];
  const schema = {
    type: 'object',
    properties: { allowed: { type: 'boolean' }, reason: { type: 'string' } },
    required: ['allowed', 'reason'],
  };
  for (const model of [env.AI_MODEL, env.AI_MODEL_FALLBACK].filter((m): m is string => !!m)) {
    try {
      // 備用模型會先推理再回答，推理也算在 max_tokens 裡，給寬一點
      const res = await ai.run(model, { messages, response_format: { type: 'json_schema', json_schema: schema }, max_tokens: 1000, temperature: 0 });
      const c = responseContent(res);
      const o = (typeof c === 'string' ? JSON.parse(c.replace(/^[^{]*/, '').replace(/[^}]*$/, '')) : c) as { allowed?: unknown; reason?: unknown };
      if (typeof o?.allowed === 'boolean') return { allowed: o.allowed, reason: typeof o.reason === 'string' ? o.reason.slice(0, 80) : '' };
    } catch (e) {
      console.warn(`bottle moderation with ${model} failed: ${String(e)}`);
    }
  }
  throw new ReportError(503, '暫時沒辦法審核內容，請稍後再丟');
}

async function countSince(env: Env, sql: string, binds: unknown[]): Promise<number> {
  return (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0;
}

export interface BottleQuota {
  /** 過去 24 小時丟了幾個 */
  used: number;
  /** 每天最多丟幾個 */
  limit: number;
  /** 還能丟幾個 */
  left: number;
}

/** 今天的額度：過去 24 小時最多 3 個 */
export async function bottleQuota(env: Env, dev: string, now: number): Promise<BottleQuota> {
  const used = await countSince(env, 'SELECT COUNT(*) AS n FROM bottles WHERE device_id = ? AND created_at > ?', [dev, now - 86400]);
  return { used, limit: PER_DEVICE_PER_DAY, left: Math.max(0, PER_DEVICE_PER_DAY - used) };
}

/** 瓶子證明：編號、丟的時間、內容的 SHA-256，加上伺服器的簽章（HMAC-SHA256，金鑰從加鹽的值來）；sig 只留前 32 個字 */
export interface BottleProof {
  no: number;
  createdAt: number;
  sha256: string;
  sig: string;
}

const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const sha256Hex = async (text: string): Promise<string> => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

async function proofSig(env: Env, no: number, createdAt: number, sha: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`bottle-proof|${await hashSalt(env)}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`bottle|${no}|${createdAt}|${sha}`))).slice(0, 32);
}

export async function bottleProof(env: Env, b: { id: number; created_at: number; text: string }): Promise<BottleProof> {
  const sha = await sha256Hex(b.text);
  return { no: b.id, createdAt: b.created_at, sha256: sha, sig: await proofSig(env, b.id, b.created_at, sha) };
}

/** 丟的人、撿到的人才拿得到瓶子證明（看得到內容的人） */
export async function proofFor(env: Env, device: string | null, id: number): Promise<BottleProof> {
  const dev = needDevice(device);
  const b = await env.DB.prepare('SELECT id, created_at, text, device_id FROM bottles WHERE id = ?').bind(id).first<{ id: number; created_at: number; text: string; device_id: string }>();
  if (!b) throw new ReportError(404, '找不到這個瓶子');
  if (b.device_id !== dev && !(await env.DB.prepare('SELECT 1 AS x FROM bottle_picks WHERE bottle_id = ? AND device_id = ?').bind(id, dev).first()))
    throw new ReportError(403, '丟的人和撿到的人才看得到瓶子證明');
  return bottleProof(env, b);
}

/** 驗證瓶子證明：簽章對得上就是這個網站發出的、內容沒被改過（瓶子刪掉了也驗得出來） */
export async function verifyProof(env: Env, body: { no?: unknown; createdAt?: unknown; sha256?: unknown; sig?: unknown }): Promise<{ valid: boolean }> {
  const { no, createdAt, sha256, sig } = body;
  if (typeof no !== 'number' || typeof createdAt !== 'number' || typeof sha256 !== 'string' || typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return { valid: false };
  return { valid: (await proofSig(env, no, createdAt, sha256)) === sig.toLowerCase() };
}

const validPoint = (lat: unknown, lng: unknown): { lat: number; lng: number } | null =>
  typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;

/** 丟一個瓶子：在你現在的位置附近 */
export async function dropBottle(env: Env, device: string | null, ip: string, body: { text?: unknown; lat?: unknown; lng?: unknown; photo?: unknown }, now: number): Promise<PickedBottle> {
  const dev = needDevice(device);
  const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : '';
  const bad = ruleCheck(text);
  if (bad) throw new ReportError(400, bad);
  const at = validPoint(body.lat, body.lng);
  if (!at) throw new ReportError(400, '要先定位才能丟瓶子');
  const photo = parsePhoto(body.photo);
  if (photo && !env.BOTTLE_PHOTOS) throw new ReportError(503, '照片暫時不能放，先不放照片吧');

  const quota = await bottleQuota(env, dev, now);
  if (quota.left <= 0) throw new ReportError(429, `每天最多丟 ${PER_DEVICE_PER_DAY} 個，明天再來`);
  if ((await countSince(env, 'SELECT COUNT(*) AS n FROM bottles WHERE ip_hash = ? AND created_at > ?', [ip, now - 86400])) >= PER_IP_PER_DAY)
    throw new ReportError(429, '這個網路今天丟太多瓶子了，明天再來');
  if ((await countSince(env, 'SELECT COUNT(*) AS n FROM bottles WHERE created_at > ?', [now - 3600])) >= GLOBAL_PER_HOUR)
    throw new ReportError(429, '現在丟瓶子的人太多，請稍後再試');

  const verdict = await moderate(env, text);
  if (!verdict.allowed) throw new ReportError(422, `這句話不能丟${verdict.reason ? `：${verdict.reason}` : ''}`);
  let key: string | null = null;
  if (photo && env.BOTTLE_PHOTOS) {
    const pv = await moderatePhoto(env, photo.dataUrl);
    if (!pv.allowed) throw new ReportError(422, `這張照片不能放${pv.reason ? `：${pv.reason}` : ''}`);
    key = `bottles/${now}-${crypto.randomUUID()}.jpg`;
    await env.BOTTLE_PHOTOS.put(key, stripJpegMeta(photo.bytes), { httpMetadata: { contentType: 'image/jpeg' } });
  }

  const p = scatter(at);
  const row = await env.DB.prepare(
    "INSERT INTO bottles (device_id, text, lat, lng, origin_lat, origin_lng, status, world, ip_hash, created_at, expires_at, photo_key) VALUES (?, ?, ?, ?, ?, ?, 'active', 'earth', ?, ?, ?, ?) RETURNING *",
  )
    .bind(dev, text, p.lat, p.lng, p.lat, p.lng, ip, now, now + BOTTLE_TTL_SEC, key)
    .first<BottleRow>()
    .catch(async (e) => {
      if (key) await env.BOTTLE_PHOTOS?.delete(key);
      throw e;
    });
  if (!row) throw new ReportError(500, '存檔失敗，請稍後再試');
  return { bottle: toOut(row, dev, false), text: row.text, photo: !!row.photo_key };
}

/** 撿起來（或自己的）瓶子：瓶子、內容、有沒有照片（照片另外拿：bottlePhoto） */
export interface PickedBottle {
  bottle: BottleOut;
  text: string;
  photo: boolean;
}

function toOut(r: BottleRow, dev: string | null, picked: boolean): BottleOut {
  return { id: r.id, world: r.world, lat: r.lat, lng: r.lng, createdAt: r.created_at, expiresAt: r.expires_at, mine: r.device_id === dev, picked, picks: r.picks };
}

/** 附近漂流中的瓶子（沒有內容）；world = 'woof' 是汪星海上的全部（汪星很小，不分附近） */
export async function listBottles(env: Env, device: string | null, q: { lat?: number; lng?: number; radiusKm: number; world?: BottleWorld }, now: number): Promise<BottleOut[]> {
  const world = q.world ?? 'earth';
  const conds = ["status = 'active'", 'world = ?', 'expires_at > ?'];
  const binds: unknown[] = [world, now];
  // 有位置就從近到遠排，瓶子很多時也一定拿得到最近的那幾個（雷達外圈的方向提示要用）
  let order = 'created_at DESC';
  if (world === 'earth' && q.lat !== undefined && q.lng !== undefined) {
    const k = Math.max(0.2, Math.cos((q.lat * Math.PI) / 180));
    const dLat = q.radiusKm / 111;
    const dLng = q.radiusKm / (111 * k);
    conds.push('lat BETWEEN ? AND ?', 'lng BETWEEN ? AND ?');
    binds.push(q.lat - dLat, q.lat + dLat, q.lng - dLng, q.lng + dLng);
    order = '(lat - ?) * (lat - ?) + (lng - ?) * (lng - ?) * ?';
    binds.push(q.lat, q.lat, q.lng, q.lng, k * k);
  }
  const { results } = await env.DB.prepare(`SELECT * FROM bottles WHERE ${conds.join(' AND ')} ORDER BY ${order} LIMIT ${world === 'woof' ? WOOF_LIST_LIMIT : LIST_LIMIT}`)
    .bind(...binds)
    .all<BottleRow>();
  const picked = new Set<number>();
  if (device && results.length > 0) {
    const r = await env.DB.prepare(`SELECT bottle_id FROM bottle_picks WHERE device_id = ? AND bottle_id IN (${results.map(() => '?').join(',')})`)
      .bind(device, ...results.map((b) => b.id))
      .all<{ bottle_id: number }>();
    for (const x of r.results) picked.add(x.bottle_id);
  }
  return results.map((b) => toOut(b, device, picked.has(b.id)));
}

/** 分享出去的連結打開時看的瓶子（沒有內容）：還在漂（地球上、汪星的海上）、被撿走了、不見了（沉下去、收回、被檢舉） */
export async function bottleInfo(env: Env, device: string | null, id: number, now: number): Promise<{ id: number; state: 'active' | 'picked' | 'gone'; bottle: BottleOut | null }> {
  const b = await env.DB.prepare('SELECT * FROM bottles WHERE id = ?').bind(id).first<BottleRow>();
  if (!b) return { id, state: 'gone', bottle: null };
  if (b.status === 'picked') return { id, state: 'picked', bottle: null };
  if (b.status !== 'active' || b.expires_at <= now) return { id, state: 'gone', bottle: null };
  const picked = device ? !!(await env.DB.prepare('SELECT 1 AS x FROM bottle_picks WHERE bottle_id = ? AND device_id = ?').bind(id, device).first()) : false;
  return { id, state: 'active', bottle: toOut(b, device, picked) };
}

/**
 * 撿起來：要在 PICK_RADIUS_M 內。一個瓶子只能被一個人撿走，撿走後就從所有人的雷達上消失，
 * 只有撿到的人（在「我撿到的」）和丟的人看得到內容。自己丟的可以看，但不能撿。
 */
export async function pickBottle(env: Env, device: string | null, id: number, body: { lat?: unknown; lng?: unknown; world?: unknown }, now: number): Promise<PickedBottle> {
  const dev = needDevice(device);
  const b = await env.DB.prepare("SELECT * FROM bottles WHERE id = ? AND status IN ('active', 'picked')").bind(id).first<BottleRow>();
  if (!b) throw new ReportError(404, '這個瓶子已經沉下去了');
  if (b.device_id === dev) return { bottle: toOut(b, dev, false), text: b.text, photo: !!b.photo_key };
  const mine = await env.DB.prepare('SELECT 1 AS x FROM bottle_picks WHERE bottle_id = ? AND device_id = ?').bind(id, dev).first();
  if (mine) return { bottle: toOut(b, dev, true), text: b.text, photo: !!b.photo_key };
  if (b.status !== 'active' || b.expires_at <= now) throw new ReportError(410, '晚了一步，這個瓶子已經被撿走或沉下去了');
  const at = validPoint(body.lat, body.lng);
  const world: BottleWorld = body.world === 'woof' ? 'woof' : 'earth';
  if (!at) throw new ReportError(400, '要先定位才能撿瓶子');
  if (world !== b.world) throw new ReportError(403, b.world === 'woof' ? '這個瓶子漂到汪星的海上了，搭火箭到汪星才撿得到' : '這個瓶子在地球上，回地球才撿得到');
  const d = distM(at, b, world === 'woof' ? WOOF_M : undefined);
  if (d > PICK_RADIUS_M) throw new ReportError(403, `還差 ${Math.round(d - PICK_RADIUS_M)} m，再走近一點才撿得到`);
  const kept = await countSince(env, 'SELECT COUNT(*) AS n FROM bottle_picks WHERE device_id = ? AND collected_at > ?', [dev, 0]);
  if (kept >= MAX_LETTERS) throw new ReportError(429, `瓶中信收藏滿 ${MAX_LETTERS} 封了，先移出一些再撿`);
  // 兩個人同時撿：只有先改到狀態的那個人算數
  const won = await env.DB.prepare("UPDATE bottles SET status = 'picked', picks = 1 WHERE id = ? AND status = 'active' RETURNING *").bind(id).first<BottleRow>();
  if (!won) throw new ReportError(410, '晚了一步，這個瓶子剛被別人撿走了');
  // 撿到就收進瓶中信收藏
  await env.DB.prepare('INSERT OR IGNORE INTO bottle_picks (bottle_id, device_id, created_at, collected_at) VALUES (?, ?, ?, ?)').bind(id, dev, now, now).run();
  return { bottle: toOut(won, dev, true), text: won.text, photo: !!won.photo_key };
}

export interface MyBottles {
  quota: BottleQuota;
  dropped: Array<{ id: number; text: string; photo: boolean; world: BottleWorld; createdAt: number; expiresAt: number; seaAt: number | null; picks: number; pickedAt: number | null; status: BottleStatus; driftM: number }>;
  /** 瓶中信收藏：撿到就收進來；world 是在哪裡撿到的 */
  letters: Array<{ id: number; text: string; photo: boolean; world: BottleWorld; createdAt: number; pickedAt: number; driftM: number }>;
}

/** 我丟的、我的瓶中信收藏 */
export async function myBottles(env: Env, device: string | null, now: number): Promise<MyBottles> {
  const dev = needDevice(device);
  const dropped = await env.DB.prepare(
    `SELECT b.*, (SELECT MIN(created_at) FROM bottle_picks p WHERE p.bottle_id = b.id) AS picked_at FROM bottles b
      WHERE b.device_id = ? AND b.status != 'deleted' AND b.created_at > ? ORDER BY b.id DESC LIMIT 30`,
  )
    .bind(dev, now - 31 * 86400)
    .all<BottleRow & { picked_at: number | null }>();
  // 收藏的信；被檢舉藏起來、被管理者移除的不顯示
  const mine = await env.DB.prepare(
    `SELECT b.id, b.text, b.photo_key, b.world, b.lat, b.lng, b.origin_lat, b.origin_lng, b.created_at, p.created_at AS picked_at
       FROM bottle_picks p JOIN bottles b ON b.id = p.bottle_id
      WHERE p.device_id = ? AND p.collected_at IS NOT NULL AND b.status IN ('active', 'picked')
      ORDER BY p.created_at DESC LIMIT ${MAX_LETTERS}`,
  )
    .bind(dev)
    .all<Pick<BottleRow, 'id' | 'text' | 'photo_key' | 'world' | 'lat' | 'lng' | 'origin_lat' | 'origin_lng' | 'created_at'> & { picked_at: number }>();
  return {
    quota: await bottleQuota(env, dev, now),
    dropped: dropped.results.map((b) => ({
      id: b.id,
      text: b.text,
      photo: !!b.photo_key,
      world: b.world,
      createdAt: b.created_at,
      expiresAt: b.expires_at,
      seaAt: b.sea_at,
      picks: b.picks,
      pickedAt: b.picked_at,
      status: b.expires_at <= now && b.status === 'active' ? ('deleted' as const) : b.status,
      driftM: driftOf(b),
    })),
    letters: mine.results.map((p) => ({ id: p.id, text: p.text, photo: !!p.photo_key, world: p.world, createdAt: p.created_at, pickedAt: p.picked_at, driftM: driftOf(p) })),
  };
}

/** 移出收藏（之後就看不到這封信了） */
export async function uncollectLetter(env: Env, device: string | null, id: number): Promise<{ collected: false }> {
  const dev = needDevice(device);
  const r = await env.DB.prepare('UPDATE bottle_picks SET collected_at = NULL WHERE bottle_id = ? AND device_id = ? AND collected_at IS NOT NULL').bind(id, dev).run();
  if ((r.meta.changes ?? 0) === 0) throw new ReportError(404, '找不到你收藏的這封信');
  return { collected: false };
}

/** 收回自己丟的瓶子（還沒被撿走的） */
export async function deleteBottle(env: Env, device: string | null, id: number): Promise<{ ok: true }> {
  const dev = needDevice(device);
  const r = await env.DB.prepare("UPDATE bottles SET status = 'deleted' WHERE id = ? AND device_id = ? AND status IN ('active', 'hidden')").bind(id, dev).run();
  if ((r.meta.changes ?? 0) === 0) throw new ReportError(404, '這個瓶子已經被撿走或不見了，收不回來');
  return { ok: true };
}

/** 檢舉：撿到的人才能檢舉（瓶子已經只有他看得到），檢舉後藏起來交給管理者確認 */
export async function reportBottle(env: Env, device: string | null, ip: string, id: number, reason: unknown, now: number): Promise<{ hidden: boolean }> {
  const dev = needDevice(device);
  const picked = await env.DB.prepare('SELECT 1 AS x FROM bottle_picks WHERE bottle_id = ? AND device_id = ?').bind(id, dev).first();
  if (!picked) throw new ReportError(403, '撿起來看過才能檢舉');
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO bottle_reports (bottle_id, device_id, ip_hash, reason, created_at) VALUES (?, ?, ?, ?, ?)').bind(
      id,
      dev,
      ip,
      typeof reason === 'string' ? reason.slice(0, 100) : null,
      now,
    ),
    env.DB.prepare("UPDATE bottles SET reports = reports + 1, status = CASE WHEN status IN ('active', 'picked') THEN 'hidden' ELSE status END WHERE id = ?").bind(id),
  ]);
  return { hidden: true };
}

// ---- 管理者 ----

export async function adminListBottles(env: Env, status: string | null): Promise<Array<Omit<BottleRow, 'ip_hash' | 'device_id'>>> {
  const r = status
    ? await env.DB.prepare('SELECT * FROM bottles WHERE status = ? ORDER BY id DESC LIMIT 200').bind(status).all<BottleRow>()
    : await env.DB.prepare('SELECT * FROM bottles ORDER BY id DESC LIMIT 200').all<BottleRow>();
  return r.results.map(({ ip_hash: _i, device_id: _d, ...rest }) => rest);
}

/** 移除，或恢復（被撿走的恢復成已撿走，還沒撿的恢復到雷達上） */
export async function adminSetBottle(env: Env, id: number, status: 'active' | 'removed'): Promise<{ ok: boolean }> {
  const r =
    status === 'removed'
      ? await env.DB.prepare("UPDATE bottles SET status = 'removed' WHERE id = ?").bind(id).run()
      : await env.DB.prepare("UPDATE bottles SET status = CASE WHEN EXISTS (SELECT 1 FROM bottle_picks WHERE bottle_id = ?) THEN 'picked' ELSE 'active' END WHERE id = ?")
          .bind(id, id)
          .run();
  return { ok: (r.meta.changes ?? 0) > 0 };
}

/**
 * 過期 30 天的瓶子整個刪掉（含撿起、檢舉紀錄）；有人收藏的信留著，只清掉 IP 雜湊和丟的人的裝置代碼。
 * 收藏的人移出收藏後，下一次就一起刪掉。
 */
export async function purgeBottles(env: Env, cutoff: number): Promise<number> {
  const old = 'SELECT id FROM bottles WHERE expires_at < ?';
  const kept = 'SELECT bottle_id FROM bottle_picks WHERE collected_at IS NOT NULL';
  // 要刪的瓶子的照片先刪（R2）
  if (env.BOTTLE_PHOTOS) {
    const { results } = await env.DB.prepare(`SELECT photo_key FROM bottles WHERE expires_at < ? AND photo_key IS NOT NULL AND id NOT IN (${kept}) LIMIT 1000`)
      .bind(cutoff)
      .all<{ photo_key: string }>();
    if (results.length) await env.BOTTLE_PHOTOS.delete(results.map((r) => r.photo_key));
  }
  const r = await env.DB.batch([
    env.DB.prepare(`DELETE FROM bottle_picks WHERE collected_at IS NULL AND bottle_id IN (${old})`).bind(cutoff),
    env.DB.prepare(`DELETE FROM bottle_reports WHERE bottle_id IN (${old})`).bind(cutoff),
    env.DB.prepare(`DELETE FROM bottles WHERE expires_at < ? AND id NOT IN (${kept})`).bind(cutoff),
    env.DB.prepare("UPDATE bottles SET ip_hash = NULL, device_id = '' WHERE expires_at < ? AND device_id != ''").bind(cutoff),
  ]);
  return r.reduce((n, x) => n + (x.meta.changes ?? 0), 0);
}
