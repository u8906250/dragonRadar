# 洋流雷達 dragonRadar

從 Threads 找出「某時某地免費發放」的貼文，解析出時間與地點，
時間一到就在雷達畫面上顯示光點與相對位置，發完或過期就消失。
預設主題「洋流雷達」沿用 [台北大洋流](https://current.puma.taipei/) 船艙的視覺：品牌橘、奶油紙、墨線、海綠與硬陰影。

- 網址：**https://current-radar.pages.dev**（Cloudflare Pages，主要）；備用 https://u8906250.github.io/dragonRadar/
- 前端：Vite + TypeScript，自繪 SVG 雷達，Leaflet + OpenStreetMap 地圖，部署在 Cloudflare Pages 與 GitHub Pages
- 後端：Cloudflare Worker + D1 + Cron Trigger + Workers AI
- 資料來源：Threads 官方 API 的 `keyword_search`（需要 `threads_keyword_search` 權限審核）
- 地點轉座標：OpenStreetMap Nominatim（結果快取在 D1）

```
web/      前端（GitHub Pages）
worker/   Cloudflare Worker（API、排程、資料庫）
```

## 運作流程

1. 每 10 分鐘 Cron 喚醒 Worker，對每個關鍵字呼叫 Threads `keyword_search`（RECENT，`since` 只拿新貼文）。
2. 新貼文丟給 Workers AI 抽出：是否為實體發放、開始／結束時間、地點文字、可搜尋的地點名稱、信心分數。
3. 地點用 Nominatim 轉成座標，寫進 `events`。
4. 事件狀態：`upcoming` → `active`（到開始時間）→ `ended`（到結束時間，或作者後續貼文／回覆出現「發完」等字眼）。
5. 前端每分鐘向 `/api/events` 拿附近事件，用使用者座標算方位與距離畫在雷達上；進行中事件變多時嗶聲＋通知。

沒有 Threads token 或 `MOCK_MODE=true` 時，Worker 會用內建示範貼文跑同一套流程，前端會標示「示範資料」。

## 主題

右上角「主題」可切換，選擇記在手機裡，也可用網址參數預覽，例如 `?theme=neon`。

| id | 名稱 | 掃描 | 光點 | 提示音 |
|---|---|---|---|---|
| `current` | 洋流雷達（預設） | 向外擴散的水波 | 橘色浮標，羅盤 N/E/S/W | 聲納 ping |
| `dragon` | 龍珠雷達 | 旋轉扇形 | 黃色閃點 | 嗶嗶兩聲 |
| `treasure` | 尋寶地圖 | 旋轉羅盤針 | 紅色 X 記號 | 木質敲擊 |
| `neon` | 夜市霓虹 | 旋轉扇形 | 霓虹粉發光點 | 合成器 |

新增主題：在 `web/src/themes.ts` 加一筆設定，並在 `web/src/styles.css` 加一組 `:root[data-theme='...']` 變數。

## 關鍵字

- 預設搜尋「洋流飄帶」，由管理員用 `/api/admin/keywords` 新增或停用（管理員新增的會固定搜尋）。
- 一般使用者目前只能看到搜尋中的關鍵字，不能修改。等帳號綁定做好，把 `wrangler.toml` 的 `ALLOW_USER_KEYWORDS` 改成 `"true"` 就會開放：
  使用者可選擇追蹤哪些關鍵字、新增新的關鍵字；同時最多搜尋 10 個，使用者新增的 7 天沒人追蹤會自動停止。

## 手機介面

- 以手機直式為主：雷達占滿中間，底部是可上拉的清單面板，桌機則把清單放右側欄。
- 雷達左下可切 1 / 5 / 20 km、「雙北」與「全台」範圍。「雙北」是預設；「雙北」「全台」的半徑會依你的位置自動算到能涵蓋整個區域（全台含澎湖、金門、馬祖）；右上可切換地圖、開啟指北針（雷達跟著手機朝向轉，iOS 會先問權限）。
- 新事件開始時：嗶聲、震動（Android）、頁內橫幅，有授權時再加系統通知。聲音需要先按一次右上角「通知」。
- 有 manifest 與圖示，可「加入主畫面」以全螢幕開啟。

## 本機開發

```bash
npm install

# Worker
cd worker
cp .dev.vars.example .dev.vars          # MOCK_MODE=true、ADMIN_TOKEN
npm run db:migrate:local
npm run db:seed:local                   # 塞幾個台北市區的示範事件（可略過）
npm run dev                             # http://localhost:8787

# 前端（另一個終端機）
cd web
npm run dev                             # http://localhost:5173，預設打 http://localhost:8787
```

手動觸發抓取（示範模式會產生假貼文並跑 AI 抽取；`wrangler dev` 需能連到 Workers AI）：

```bash
curl -X POST http://localhost:8787/api/admin/ingest -H 'authorization: Bearer dev-admin-token'
```

手動丟一則貼文進去測試解析：

```bash
curl -X POST http://localhost:8787/api/admin/posts \
  -H 'authorization: Bearer dev-admin-token' -H 'content-type: application/json' \
  -d '{"text":"今天下午三點在捷運市政府站2號出口發洋流漂帶，發完為止","username":"someone"}'
```

## 部署

### 1. Cloudflare

```bash
cd worker
npx wrangler login
npx wrangler d1 create dragon-radar      # 把回傳的 database_id 填進 wrangler.toml
npx wrangler secret put ADMIN_TOKEN      # 自己產生一串亂數
npx wrangler secret put THREADS_ACCESS_TOKEN   # 有 token 再設，沒有就先跑示範模式
npm run db:migrate:remote
npm run deploy
```

`wrangler.toml` 的 `ALLOWED_ORIGINS` 要包含 GitHub Pages 的網域（預設已填 `https://u8906250.github.io`）。
`NOMINATIM_USER_AGENT` 請改成可聯絡到你的資訊，這是 Nominatim 的使用條款要求。

### 2. GitHub

- Settings → Pages → Source 選 **GitHub Actions**
- Settings → Secrets and variables → Actions
  - Secrets：`CLOUDFLARE_API_TOKEN`（權限：Workers Scripts Edit、D1 Edit、Workers AI Read、Cloudflare Pages Edit）、`CLOUDFLARE_ACCOUNT_ID`
  - Variables：`API_BASE` 可選；不設就用 `web/src/api.ts` 裡寫死的正式 Worker 網址

之後 push 到 `main`：改到 `web/` 會重新部署 Pages，改到 `worker/` 會重新部署 Worker。

### 3. Threads API

給 Meta App 設定用的網址：

| 欄位 | 網址 |
|---|---|
| 隱私權政策 | https://current-radar.pages.dev/privacy.html |
| 服務條款 | https://current-radar.pages.dev/terms.html |
| 資料刪除說明 | https://current-radar.pages.dev/data-deletion.html |
| 重新導向回呼 | https://dragon-radar.happybadminton.workers.dev/auth/threads/callback |
| 解除安裝回呼 | https://dragon-radar.happybadminton.workers.dev/auth/threads/uninstall |
| 刪除回呼 | https://dragon-radar.happybadminton.workers.dev/auth/threads/delete |
| App 圖示 | web/public/icon-1024.png |

流程：

1. 在 [Meta for Developers](https://developers.facebook.com/) 建 App，使用案例選 Threads API，權限加 `threads_basic`、`threads_keyword_search`。
2. 在 Cloudflare Worker 設 secret：`THREADS_APP_ID`、`THREADS_APP_SECRET`（App 設定裡 Threads 的那一組）。
3. 打開 `https://dragon-radar.happybadminton.workers.dev/auth/threads/start?key=<ADMIN_TOKEN>` 用 Threads 帳號授權，長效 token（60 天）會自動存進 D1，之後每週一自動續期。
4. `threads_keyword_search` 送 App Review 通過前，只能搜到授權帳號自己的貼文。

配額：每個使用者每日 2,200 次查詢。每 10 分鐘跑 N 個關鍵字一天用掉 144 × N 次。

## API

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/health` | `{ ok, mode: 'live' \| 'mock', time }` |
| GET | `/api/events?lat=&lng=&radius_km=&horizon_h=&keywords=` | 附近、未結束、`horizon_h` 小時內會開始的事件，可用逗號分隔的關鍵字篩選 |
| GET | `/api/events/:id` | 單一事件 |
| GET | `/api/keywords` | 搜尋中的關鍵字、上限、是否開放使用者新增 |
| POST | `/api/keywords` | 使用者新增關鍵字（`ALLOW_USER_KEYWORDS` 為 true 才開放） |
| POST | `/api/admin/posts` | 手動塞貼文並立即解析 |
| POST | `/api/admin/ingest` | 立刻跑一次抓取與狀態更新 |
| GET | `/api/admin/events?status=` | 所有事件（含 ended、unlocated） |
| GET | `/api/admin/posts` | 最近 100 則原始貼文與解析結果 |
| GET/POST/DELETE | `/api/admin/keywords[/:id]` | 關鍵字管理（新增的會固定搜尋） |
| GET/POST | `/api/admin/token` | 查看／更新 Threads token |

admin 路徑需要 `Authorization: Bearer <ADMIN_TOKEN>`。

## 之後可以做的

- Web Push：目前通知只在頁面開著時出現，背景推播需要 Service Worker + VAPID。
- 關鍵字管理介面。
- 用 Claude API 取代 Workers AI 做抽取，準確度更高。
- 指北針模式：用 DeviceOrientation 讓雷達跟著手機方向轉。
