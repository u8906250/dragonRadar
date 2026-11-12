/**
 * 分享活動的連結 current-radar.pages.dev/e/編號（Cloudflare Pages Functions；v1.688 使用者說的，網址不要出現後端的 workers.dev）：
 * 給 LINE、Threads 這些讀預覽的看活動標題、時間、地點（og:title、og:description），人打開就直接轉到雷達、選到那一則（/?event=編號）。
 * 活動資料在這裡跟後端拿（/api/share/編號），分享出去的網址、預覽都看不到後端的位址
 */
interface ShareInfo {
  id: number;
  module: string;
  ended: boolean;
  title?: string;
  kind?: string;
  topic?: string | null;
  startAt?: number;
  endAt?: number;
  allDay?: boolean;
  spot?: boolean;
  tz?: string | null;
  placeText?: string;
}

const PROD_API = 'https://dragon-radar.happybadminton.workers.dev';
const MODULE_NAMES: Record<string, string> = { current: '洋流雷達', dog: '狗狗陪伴', badminton: '羽球臨打', food: '美食品味', work: '找工作' };

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** 「11/13（週五）19:00」；整天的只寫日期。國外的照當地時間 */
function when(info: ShareInfo): string {
  if (!info.startAt) return '';
  const tz = info.tz || 'Asia/Taipei';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('zh-TW', { timeZone: tz, month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(info.startAt * 1000))
      .map((p) => [p.type, p.value]),
  );
  const day = `${parts.month}/${parts.day}（${parts.weekday}）`;
  return info.allDay ? day : `${day}${parts.hour}:${parts.minute} 開始`;
}

export async function onRequestGet(ctx: { params: Record<string, string | string[]>; request: Request; env: Record<string, unknown> }): Promise<Response> {
  const origin = new URL(ctx.request.url).origin;
  const id = /^\d{1,12}$/.test(String(ctx.params.id)) ? String(ctx.params.id) : null;
  if (!id) return Response.redirect(`${origin}/`, 302);
  const api = typeof ctx.env.API_BASE === 'string' && ctx.env.API_BASE ? ctx.env.API_BASE.replace(/\/$/, '') : PROD_API;
  let info: ShareInfo | null = null;
  try {
    const r = await fetch(`${api}/api/share/${id}`);
    if (r.ok) info = (await r.json()) as ShareInfo;
  } catch {
    // 後端連不上：照樣轉到雷達，雷達自己找
  }
  const module = info?.module && MODULE_NAMES[info.module] ? info.module : 'current';
  const target = `/?event=${info?.id ?? id}${module !== 'current' ? `&module=${module}` : ''}`;
  const site = MODULE_NAMES[module];
  const live = info && !info.ended && info.title ? info : null;
  const title = live ? live.title! : info ? '這個活動已經結束了' : '找不到這個活動';
  const desc = live
    ? [live.topic, live.spot ? '固定據點' : null, when(live), live.placeText].filter(Boolean).join('・')
    : '打開洋流雷達，看看附近還有什麼活動';
  const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}｜${esc(site)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(`${origin}/e/${id}`)}">
<meta property="og:image" content="${esc(`${origin}/icon-1024.png`)}">
<meta name="twitter:card" content="summary">
<link rel="canonical" href="${esc(`${origin}/e/${id}`)}">
<script>location.replace(${JSON.stringify(target)});</script>
</head>
<body style="font-family:system-ui,sans-serif;padding:24px">
<p><a href="${esc(target)}">打開${esc(site)}看「${esc(title)}」</a></p>
</body>
</html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' } });
}
