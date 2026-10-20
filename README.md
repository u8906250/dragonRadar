# 洋流雷達 dragonRadar

從 Threads 找出「某時某地免費發放」的貼文，解析出時間與地點，
時間一到就在雷達畫面上顯示光點與相對位置，發完或過期就消失。
預設主題「洋流雷達」沿用 [台北大洋流](https://current.puma.taipei/) 船艙的視覺：品牌橘、奶油紙、墨線、海綠與硬陰影。

- 網址：**https://current-radar.pages.dev**（Cloudflare Pages，主要）；備用 https://u8906250.github.io/dragonRadar/
- 使用說明：https://current-radar.pages.dev/help.html（`web/public/help.html`）
- 前端：Vite + TypeScript，自繪 SVG 雷達，Leaflet + OpenStreetMap 地圖，部署在 Cloudflare Pages 與 GitHub Pages
- 後端：Cloudflare Worker + D1 + Cron Trigger + Workers AI
- 資料來源：Threads 官方 API 的 `keyword_search`（需要 `threads_keyword_search` 權限審核）、使用者貼上的 Threads 貼文連結、台北大洋流官方航線與[車掃地圖](https://current-map.puma.taipei/)、Yahoo 新聞 RSS
- 地點轉座標：OpenStreetMap Nominatim（結果快取在 D1）

```
web/      前端（GitHub Pages）
worker/   Cloudflare Worker（API、排程、資料庫）
```

## 運作流程

1. 每 10 分鐘 Cron 喚醒 Worker，對每個關鍵字呼叫 Threads `keyword_search`（RECENT，`since` 只拿新貼文）。
2. 新貼文丟給 Workers AI 抽出：是否為實體發放、開始／結束時間、地點文字、可搜尋的地點名稱、信心分數。
3. 地點轉成座標，寫進 `events`（`locatePlaceForEvent`）：貼文有寫門牌就只用門牌查（Photon、Overpass，跟 `locatePlace` 同一套；地點欄沒寫縣市時從另一欄補，縣市不確定就不查），查不到就退到鄉鎮區中心標成約略位置，**不拿店名或「XX服務處」去猜**（會查到同名的別的機構）；沒有門牌才用 Nominatim 查地名。固定據點的每天時段只定位一次；一則貼文的 Overpass 最多查 25 秒，之後只用 Photon。
4. 事件狀態：`upcoming` → `active`（到開始時間）→ `ended`（到結束時間，或作者後續貼文／回覆出現「發完」等字眼）。
5. 前端每分鐘向 `/api/events` 拿附近事件，用使用者座標算方位與距離畫在雷達上；進行中事件變多時嗶聲＋通知。

### 車掃路線

每 10 分鐘讀台北大洋流官網的「未來航線」與「大洋流車掃地圖」：

- 車掃地圖的頁面寫出車掃時間（例如「車掃 17:30–18:30」）與抵達後的活動（「市政開講 18:30–20:30 · 民權公園」），路段 API 給實際路徑與各段認領人數。官網的船票時間是出發時間，車掃地圖讀不到時才用它。
- 事件：起點（出發後保留 15 分鐘）、加油點（整天，到預計經過後 15 分鐘）、終點（抵達後的活動，沒有就保留 1 小時）。
- 加油點的預計經過時間：投影到路線上，用累計距離在出發到抵達之間等速推算。路段名稱有寫到的加油點直接用車掃地圖的座標，地址查到的離路線超過 60 m 就移到路線上。
- 新聞、Threads、使用者貼的連結講的是同一場車掃就併進官方那一場（`events.merged_into`）：類型是活動、提到車掃／掃街／洋流號／市政開講、同一天、提到同一區（松山、信義、松信）或路線上的地名，或在路線 1.5 km 內。每次排程重新比對，前端只在官方那一場列「相關報導」。
- 路線存在 `routes` 表，前端用 `/api/routes` 畫在雷達與地圖上（地圖依認領人數上色），清單合成一張「車掃」卡片與每站時間表。不顯示車隊即時位置（官方要大家不跟車）。

### 使用者回報貼文連結

使用者按「＋回報」貼上 Threads 貼文連結（Android 加到主畫面後也能從 Threads 直接分享），Worker 讀取該則貼文的公開嵌入頁 `https://www.threads.com/t/<代碼>/embed` 取得內文與作者，發文時間由貼文代碼推算（Instagram 編號前 41 位元是建立時間），再走同一套判讀流程，貼文 id 為 `link-<代碼>`。

- **先確認才上雷達**：判讀、定位完不寫進 `events`，先存在 `posts.confirm_plan`（`confirm_state = 'pending'`），回傳 `outcome: 'preview'`、`preview`（每個地點或時段一筆，固定據點的每天合成一筆，附定位結果）和 `confirm { postId, token }`（token 是貼文 id 加鹽雜湊）。回報的人按「對」打 `POST /api/reports/confirm` 才寫進雷達（寫之前再檢查一次有沒有結束、重複）；按「不對」打 `POST /api/reports/reject { note }`，`confirm_state = 'rejected'`、`confirm_note` 記哪裡錯，管理者用 `GET /api/admin/posts?confirm=rejected` 看，修好可以用 `.../reprocess` 重跑（直接上雷達）。還沒確認的貼文排程不會自己判讀；別人再貼同一則會再看到預覽、也能確認。貼文沒寫地點或時間時，回報的人可以 `POST /api/reports/supplement { postId, token, note }` 補充（200 字內，一則最多 5 次，算在同 IP 每小時的回報次數裡），存在 `posts.supplement`，判讀時接在貼文後面（「【回報的人補充】…」）再跑一次 AI；放上雷達後詳細資料會顯示「回報的人補充」。只寫行政區的地點（「中正萬華區」）不拿去查地圖，不然會被對到某個區的中心、看起來像精確位置。排程搜尋到的貼文、已確認貼文內容改了的重新判讀，照舊直接上雷達。雷達上已經有同地點（150 m 內）、還沒結束的固定據點時（`PlanItem.merge`）：同一個帳號的新貼文取代它（舊據點還沒開完的時段 `ended_reason = 'replaced'`，舊貼文 `posts.linked_to` 指向新貼文、`link_role = 'previous'`），別人的貼文不建事件、只附上去（`link_role = 'related'`，結果 `attached_to_<事件 id>`、outcome `attached`）；預覽的 `update` 先告訴回報的人會怎樣，詳細資料的 `related`（`role`）列出這些貼文。
- 只收 7 天內的貼文；同一個 IP（加鹽雜湊）每小時 10 則、全站每小時 200 則。
- 排程每 30 分鐘重讀還在雷達上的回報貼文：刪文就下架、改成「發完了」就結束、內容改了就重新判讀。
- 活動開始後，2 個不同的人按「回報已發完」就提早下架（官方行程除外）。
- 亂貼的貼文可用 `DELETE /api/admin/posts/link-<代碼>` 移除。

### 固定據點

店家、服務處連續好幾天都能去領的，一樣走「回報 Threads 貼文」（`/api/reports`）：AI 判讀時 `spot = true` 的場次展開成每天一筆（沒寫最後一天先排 7 天，沒寫幾點結束開到當天結束）。寫「每週二、四」的只排那幾天：模型回 `weekdays`（1 = 週一 … 7 = 週日），漏掉時從貼文的「每週…」補（一定要有「每」，「10/21（週二）」這種日期註記不算），存在 `events.weekdays`，畫面寫「每週二、四 14:00–18:00」；沒寫最後一天時排兩週（每天開的是 7 天）。模型給的最後一天（`until`）要在貼文或補充裡找得到那個日期（「10/29」「10月29日」「10/17~29」），找不到就當成沒寫（模型常自己填年底），畫面寫「發完為止」。

以前另外有「回報固定據點」（使用者填地點、開放時間，自動審核、沒把握才人工），**已經拿掉**，統一用發放或活動判斷：前端沒有入口，`POST /api/spot-requests` 回 410 請使用者改貼連結。之前送出的資料照舊：`GET /api/spot-requests?keys=` 查進度、`POST /api/spot-requests/cancel` 取消、管理者的 `GET /api/admin/spot-requests`、`.../:id/approve|reject|auto` 都還能用（已上雷達的 `spot-<代碼>` 據點不受影響）。地點定位的 `locatePlace`（門牌先問 Photon，查不到再用 Overpass，同側前後門牌推算）也還在，發放判讀的門牌查詢用的是同一套。

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
- 雷達左下可切 1 / 5 / 20 km、「雙北」與「全台」範圍。「雙北」照台北市＋新北市的縣市界判斷（`web/src/shuangbei.ts`，OpenStreetMap 新北市行政界簡化，© OpenStreetMap contributors，ODbL），雷達與地圖畫出輪廓，基隆、桃園、宜蘭算雙北以外。「雙北」是預設；「雙北」「全台」的半徑會依你的位置自動算到能涵蓋整個區域（全台含澎湖、金門、馬祖）；右上可切換地圖、開啟指北針（雷達跟著手機朝向轉，iOS 會先問權限）。
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
| 隱私權政策 | https://current-radar.pages.dev/privacy |
| 服務條款 | https://current-radar.pages.dev/terms |
| 資料刪除說明 | https://current-radar.pages.dev/data-deletion |
| 重新導向回呼 | https://dragon-radar.happybadminton.workers.dev/auth/threads/callback |
| 解除安裝回呼 | https://dragon-radar.happybadminton.workers.dev/auth/threads/uninstall |
| 刪除回呼 | https://dragon-radar.happybadminton.workers.dev/auth/threads/delete |
| App 圖示 | web/public/icon-1024.png |

流程：

1. 在 [Meta for Developers](https://developers.facebook.com/) 建 App，使用案例選 Threads API，權限加 `threads_basic`、`threads_keyword_search`。
2. 在 Cloudflare Worker 設 secret：`THREADS_APP_ID`、`THREADS_APP_SECRET`（App 設定裡 Threads 的那一組）。
3. 打開 `https://dragon-radar.happybadminton.workers.dev/auth/threads/start?key=<ADMIN_TOKEN>` 用 Threads 帳號授權，長效 token（60 天）會自動存進 D1，之後每週一自動續期。
4. `threads_keyword_search` 送 App Review 通過前，只能搜到授權帳號自己的貼文。
5. 送 App Review 拿 Advanced Access 需要 App 掛在**已完成商家驗證**的 Meta 商業帳號底下。目前在找已驗證、願意讓 App 掛在名下的團隊、公司或人民團體，有意願請到 [GitHub Issues](https://github.com/u8906250/dragonRadar/issues) 留言。

配額：每個使用者每日 2,200 次查詢。每 10 分鐘跑 N 個關鍵字一天用掉 144 × N 次。

### 漂流瓶（實驗功能；匿名，擋攻擊性內容、廣告、聯絡方式）

**預設不顯示在雷達頁面。** 使用者在說明頁「十一、實驗功能」按「開啟漂流瓶」，或用網址 `?lab=bottles` 打開（`?lab=off` 關掉），開關存在瀏覽器 `localStorage` 的 `dr.lab.bottles`。沒打開的瀏覽器不會讀瓶子、不畫在雷達和地圖上、也不顯示按鈕；伺服器照常運作（含洋流漂移），`BOTTLES_ENABLED = "false"` 才是整個關掉。


使用者在自己 GPS 位置附近丟一句話（字數比照 X：上限 280，英數與一般標點算 1、中文全形與表情算 2，中文 140 字；不限正向，心情、抱怨也可以），別人走到 60 m 內才撿得起來、看得到內容。每個瓶子只能被一個人撿走（`UPDATE … WHERE status = 'active'` 搶到的人算），撿走就從雷達上消失，狀態變成 `picked`。

- 不用登入：前端產生隨機裝置代碼放在 `x-device` 標頭，伺服器只存加鹽雜湊。
- 位置在丟的時候隨機打散到 100 m 內才存（不存真正位置）；撿瓶子時的座標只用來算距離。
- 內容：先用規則擋連結、Email、電話、帳號，再交給 Workers AI 擋攻擊性內容（辱罵、嘲諷、人身攻擊任何人或團體、抹黑謠言）、仇恨威脅色情、廣告、個資；AI 失敗就不收。
- 每台裝置每天 3 個，每「回收」一個撿到的瓶子多一個（`POST /api/bottles/:id/recycle`，沒收藏的信回收後撿到的人也看不到了；一換一，額度不會越刷越多，不另設上限；都算過去 24 小時）；同 IP 每天 20 個、全站每小時 120 個；7 天後漂走，30 天後連撿起、檢舉紀錄一起刪除。
- 洋流漂移：cron 每次跑 `driftBottles`，沒人撿、上次漂超過 3 小時的瓶子往 3 km 內最近的熱鬧地方（接下來 12 小時內的發放、活動、固定據點，加上洋流總部）漂一步，一次最多 300 m，停在目標旁 80–200 m（依瓶子 id 錯開）；附近沒有就隨機晃 80 m 內。`origin_lat/lng` 記丟下時（已打散）的位置，用來顯示「漂了多遠」。
- `GET /api/bottles` 帶位置時從近到遠排，前端在雷達範圍內沒有別人的瓶子時，把 50 km 內最近的一個貼在外圈指方向。
- 瓶中信收藏（前端 `#letters` 一頁）：撿到的瓶子可以收藏信（`POST /api/bottles/:id/collect|uncollect`）、回收瓶子，兩件事分開；`GET /api/bottles/mine` 回傳 `picked`（還沒回收）與 `letters`（收藏的信）。收藏的信不會被 30 天清掉，只清掉丟的人的裝置雜湊與 IP 雜湊；移出收藏後下一次清理一起刪。每台裝置最多收藏 500 封。
- 被撿走提示：丟過瓶子的瀏覽器在打開或回到網頁時讀 `/api/bottles/mine`，有上次看過之後才被撿走的就在按鈕上加小紅點並提示一次。
- 撿到的人才能檢舉，檢舉就藏起來（`hidden`）；管理者用 `GET /api/admin/bottles?status=hidden` 看、`POST /api/admin/bottles/:id/remove|restore` 處理。
- 有人亂丟時把 `wrangler.toml` 的 `BOTTLES_ENABLED` 改成 `"false"` 整個關掉。

### 暫時性錯誤

Cloudflare D1 偶爾回「D1_ERROR: internal error」這類暫時性錯誤。`src/db.ts` 把 `env.DB` 包一層，每個查詢與 batch 碰到這類錯誤自動重試（最多再試 2 次，間隔遞增）。重試後還失敗或其他非預期錯誤，使用者只看到「暫時失敗，請再試一次」（503／500），細節寫進紀錄；`/api/admin/*` 照樣回傳細節。前端讀取類請求碰到 503 或連線中斷也會自動再試一次。

## API

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/health` | `{ ok, mode: 'live' \| 'mock', time }` |
| GET | `/api/events?lat=&lng=&radius_km=&horizon_h=&keywords=` | 附近、未結束、`horizon_h` 小時內會開始的事件，可用逗號分隔的關鍵字篩選 |
| GET | `/api/events/:id` | 單一事件 |
| GET | `/api/routes` | 今天的車掃路線：路徑、各站預計時間、各路段認領人數 |
| GET | `/api/bottles?lat=&lng=&radius_km=` | 附近漂流中的瓶子（沒有內容），標頭 `x-device` |
| POST | `/api/bottles` | 丟瓶子 `{ text, lat, lng }` |
| POST | `/api/bottles/:id/pick` | 撿瓶子 `{ lat, lng }`，60 m 內才回傳內容 |
| GET | `/api/bottles/mine` | 我丟的、我撿到的（還沒回收）、收藏的信、今天的額度 |
| DELETE | `/api/bottles/:id` | 收回自己丟的 |
| POST | `/api/bottles/:id/collect`、`/uncollect` | 收藏撿到的信、移出收藏 |
| POST | `/api/bottles/:id/report` | 檢舉（撿到的人才能檢舉） |
| POST | `/api/reports` | 使用者貼上 Threads 貼文連結 `{ url }`，回傳判讀結果（新貼文是 `preview`，確認了才上雷達） |
| POST | `/api/reports/confirm` | 確認判讀結果，放上雷達 `{ postId, token }` |
| POST | `/api/reports/supplement` | 補充地點或時間後再判讀一次 `{ postId, token, note }`，回傳新的預覽 |
| POST | `/api/reports/reject` | 判讀錯了，不放 `{ postId, token, note? }` |
| POST | `/api/events/:id/ended` | 回報已發完／已結束 |
| GET | `/api/keywords` | 搜尋中的關鍵字、上限、是否開放使用者新增 |
| POST | `/api/keywords` | 使用者新增關鍵字（`ALLOW_USER_KEYWORDS` 為 true 才開放） |
| POST | `/api/admin/posts` | 手動塞貼文並立即解析 |
| POST | `/api/admin/ingest` | 立刻跑一次抓取與狀態更新 |
| GET | `/api/admin/events?status=` | 所有事件（含 ended、unlocated） |
| GET | `/api/admin/posts` | 最近 100 則原始貼文與解析結果 |
| DELETE | `/api/admin/posts/:id` | 刪除一則貼文與它的事件 |
| DELETE | `/api/admin/posts/:id/supplement` | 拿掉回報的人補充的資料（重複或寫錯），雷達上的事件不動 |
| POST | `/api/admin/posts/:id/weekdays` | 固定據點只在每週幾開：`{ weekdays: [2, 3, 4, 5, 6, 7] }`（1 = 週一），其他天還沒結束的時段下架 |
| POST | `/api/admin/events/:id/locate` | 手動修正位置：`{ lat, lng }` 或 `{ query }`，加 `approx_area` 標成約略位置 |
| POST | `/api/admin/posts/:id/reprocess` | 用目前的規則重新判讀一則貼文（還沒結束的舊事件會先刪掉） |
| POST | `/api/admin/extract` | 只判讀不存檔，可指定 models 比較 |
| POST | `/api/admin/link-fetch` | 只讀取貼文連結的內容（確認讀得到），不判讀不存檔 |
| GET/POST/DELETE | `/api/admin/keywords[/:id]` | 關鍵字管理（新增的會固定搜尋） |
| GET/POST | `/api/admin/token` | 查看／更新 Threads token |

admin 路徑需要 `Authorization: Bearer <ADMIN_TOKEN>`。

## 之後可以做的

- Web Push：目前通知只在頁面開著時出現，背景推播需要 Service Worker + VAPID。
- 關鍵字管理介面。
- 用 Claude API 取代 Workers AI 做抽取，準確度更高。
- 指北針模式：用 DeviceOrientation 讓雷達跟著手機方向轉。
