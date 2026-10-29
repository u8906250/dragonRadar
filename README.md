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

> **改版中（2026-10-23）**：資料來源要改成統一由回報系統處理，規格還在定。`wrangler.toml` 的 `AUTO_SOURCES = "false"` 先停掉自動抓資料（下面第 1 步的 Threads 關鍵字搜尋、新聞、官方航線與合併），排程只做過期、推播、固定據點補時段、重查定位、重讀回報連結這些維護；改回 `"true"` 就恢復。`REPORTS_ENABLED` 決定哪些模組收使用者回報：`"true"` 全部、`"false"` 全部鎖住，或列出模組（目前是 `"current"`，只開洋流）。鎖住的模組伺服器不收貼連結回報、確認、補充、說判讀錯、回報已發完、意見回饋（回 503「回報功能改版中，暫時關閉」，管理者的 API 不受影響），`/api/health` 的 `reportModules` 列出開著的模組，網頁在鎖住的模組按鈕變成「回報暫停」、按了只顯示提示。洋流的回報改成只判斷活動（`ACTIVITY_SPEC`，不再分發放、固定據點）：每一場都要判讀出活動內容、地點、哪天幾點開始，而且地點在地圖上查得到才算成功；缺的記成 `incomplete:place,start` 這種原因。洋流的「補充資料」是一場一場的欄位（活動內容、日期、開始、結束、地點，加一張可以點、可以拖標記的小地圖），回傳結果的 `edit` 先填好判讀出來的每一場（沒放上雷達的也列，重複的不列）；送出打 `POST /api/reports/edit { postId, token, items: [{ title, startAt, endAt, place, lat, lng }] }`，不再問 AI：照填的資料排（結束 `null` 是沒寫結束，最長 24 小時，最多 6 場），有標位置就用標的座標，沒標照地點查（`locateTypedPlace`），一樣檢查已經過了、太久以後、雷達上重複，回傳新的預覽讓回報的人確認；改了哪些（跟判讀結果比，只寫排上雷達的場次）寫進 `posts.supplement`（「改了時間 10/27 18:00 開始、地點「…」、在地圖上標了位置」），雷達詳細資料顯示成「回報的人補充」。修改跟補充算在一起，一則最多 10 次。地點欄位旁的「查地點」打 `POST /api/reports/locate { postId, token, place }`，查法跟送出後一樣（一則最多 30 次，次數記在 `settings` 的 `locate:貼文 id`，清舊回報時一起清）：查到的標在小地圖上、寫出地名，回報的人位置不對再拖；查不到就提示怎麼寫完整。回報的人填的地點最後寫了國名（Google 地圖中文版的「…CA 94583美國」、英文的「, USA」）或有美國、加拿大、澳洲的州加郵遞區號的當成國外（`countryOfPlace`）：只在那個國家查，時區照州、省（`REGION_TZ`；地址沒寫州就用 Nominatim 查到的州）。表單的時間是活動當地的時間：國外的活動照當地時間顯示，送出時帶 `localTimes: true`，伺服器照地點的時區換算（`atLocalTimes`；舊版網頁沒帶的照台北時間），「回報的人補充」也寫當地時間。小地圖標到台灣以外時底圖換成 OpenStreetMap（國土測繪中心的只有台灣）。沒放上雷達的每一場都附 `failures`（標題、地點、原因：缺什麼、只寫「本店」、只寫日期沒寫幾點、地點查不到、已經過了、太久以後、不確定是不是活動），網頁一場一場列出來；判讀成不是活動時附上 AI 的理由（`note`）。沒寫幾點結束的也收，雷達上從開始排兩小時（`OPEN_END_SEC`），畫面寫「17:10 開始，沒寫結束時間，預估到 19:10」（不寫「發完為止」：活動不一定是發東西）；只寫「14:45 前我都在」的從現在排到 14:45。「現在開始可以領」「有就可以領」沒寫幾點的算發文當天一場，從發文時間開始（貼文或帳號簡介寫了營業時間、發文時還沒開門的從開門），寫了營業時間才排到打烊，沒寫就不寫結束；店家或發文的人自己發的（「本店」「我們有就可以領」「直接跟我們說」「今天發放」「開放索取」「限擇一」）沒寫地點時讀發文帳號的簡介找地址（模型也被告知沒寫地點不是「不是活動」的理由，地點給 null），讀簡介那次只要地點有了（就算還缺時間）就用那次的結果。連續好幾天的活動每天各一場（最多 6 場）。貼文寫了「車掃」「掃街」「車隊」、同一天又讀出兩站以上（有時間、有地點）的合成一條路線（`markRoutes`，模型另外回 `route_title` 整場名稱，一則最多 20 站；模型常漏掉一站、或把前後站的地名套到這一站，所以貼文一行一站的清單「① 14:00｜鶯歌永福宮」會跟判讀結果對一次（`reconcileRouteStops`），兩個不同的站定位在同一點時，查詢沒寫到自己站名的那站要回報的人標位置）：每一站還是雷達上的一個活動，標題「路線名稱・站名」，時間改成預計經過前 10 分鐘到經過後 15 分鐘（`ROUTE_LEAD_SEC`、`ROUTE_KEEP_SEC`）；只定位到鄉鎮區、路的站不放上雷達、不畫進路線（`approximate`），回報的人在補充資料的地圖上標出位置才放；已經經過的站只留在時間表上；寫了門牌、當時沒查到確切位置的站（門牌查詢失敗、逾時，只退到路或鄉鎮區），排程每 10 分鐘重查幾站（`relocateRouteStops`，同一站隔 20 分鐘），查到就放上雷達、路線補上這一站；有確切位置、還沒經過，雷達上卻從來沒有這一站的（任何狀態的點都沒有，已經下架、回報發完的不算），同一個排程補放上去。車掃的站寫進雷達時，重複檢查只比別的貼文和同一站（同標題、30 分鐘內）（以前連同一則的其他站也比，各站時間相同、又離不到 150 m 的站像莒光路、西藏路，後面那站預覽說會放、確認後卻沒放；不是車掃的照舊連同一則也比），`POST /api/admin/relocate-routes` 可以馬上跑一次。確認放上雷達時寫進 `routes`（id 是「貼文 id-日期」，`source = 'report'`，有確切位置的站照順序用直線連起來，沒有認領人數），還沒到那天也會出現在 `/api/routes`；網頁的清單合成一張「車掃」卡片（出發前寫哪天幾點出發，車掃中寫下一站）；出發前雷達和地圖只畫起點，點開這個車掃（時間表、其中一站、「在地圖上看路線」）才畫出整條路線和其他站，點其他地方收起，出發後一直畫；點開是每站時間表（標出離你最近的站；站名從標題「路線名稱・站名」取，回報的人地點填地址的，地址另外列在站名下面，存在每一站的 `place`），雷達上還沒到的站跟一般活動一樣寫還有多久經過，地圖上用活動的顏色畫直線（出發前虛線、經過的那段變淡），開始時的推播寫「車隊快到了」。每一站的詳細資料寫第幾站、共幾站，有「‹ 上一站」「下一站 ›」（寫站名，沒放上雷達的站跳過；在地圖上看時，那一站被卡片蓋住或不在畫面裡就移最少的距離過去，`panIntoView`）。起點、終點像賽車一樣畫成 🚩、🏁（雷達、地圖不畫圓點；時間表寫「🚩 出發」「🏁 抵達」，清單卡片「🚩 起點 → 🏁 終點」）。車掃進行中畫一台 🚗（雷達、地圖都有，下面寫「預估位置」）：照各站的預計時間，在前後兩站之間按時間比例推算直線上的位置（`carOf`，還沒到第一站在起點、過了最後一站在終點，沒有確切位置的站跳過），不是實際位置，時間表上方也寫「車隊預估在 A 到 B 之間（照各站的預計時間推算，不是實際位置）」；點雷達上的車子打開時間表，車子那一層每 5 秒只重畫自己。路線清單網頁快取 10 分鐘，`/api/events` 的每一點帶 `route: true`（這則貼文有路線，`idx_routes_post`）：剛放上雷達的車掃還不在快取裡時馬上重抓路線（同一則只重抓一次），免得出發前每一站都畫出來、要重新整理才收成只有起點。回報的人刪除自己的車掃回報（整條路線、每一站一起）放在時間表，不放在個別的站。回報預覽一條路線一塊，列出每一站會不會放上雷達。

1. 每 10 分鐘 Cron 喚醒 Worker，對每個關鍵字呼叫 Threads `keyword_search`（RECENT，`since` 只拿新貼文）。
2. 新貼文丟給 Workers AI 抽出：是否為實體發放、開始／結束時間、地點文字、可搜尋的地點名稱、信心分數。21 天內開始的才收（`MAX_FUTURE_SEC`）。國外的活動（例如美國灣區的僑胞活動）模型另外回 `country`（ISO 兩碼）與 `timezone`（IANA）：時間照當地時間換算（`localizeTimes`，夏令時間也算；沒給時區時只有單一時區的國家照國家補，美國這種好幾個時區的不猜），地點只在那個國家用 Nominatim 查（`geocodeWorld`，先拿掉 Nominatim 看不懂的單位號「Blvd D」「Suite 100」「#5」和黏在最後的中文國名（`cleanWorldAddress`），「, CA, USA」這種後面的州、國家再一段一段拿掉查，至少留地名加城市；只對到城市的標成約略位置；查到的州、省（`ISO3166-2-lvl4`）跟著存在快取），時區存在 `events.tz`，畫面用當地時間顯示、詳細資料附台灣時間；國外的固定據點先當單次（每天的時段是照台灣時間排的）。手機推播的深夜不推照訂閱者自己的時區（`push_subscriptions.tz`）。主要模型 `AI_MODEL`（Qwen3 30B）判讀失敗或地點亂碼時換備用模型 `AI_MODEL_FALLBACK`（gpt-oss-120b，2026-10-27 從 Mistral Small 3.1 換過來：比較慢、比較貴，但要報名的晚會、店家只限今日的發放這類小模型常判成不是活動的，它判得出來）；使用者貼連結回報的，主要模型說「不是活動」也再問備用模型一次（`secondOpinion`，主要模型對同一則有時判成不是），備用模型壞掉就照主要模型的。
3. 地點轉成座標，寫進 `events`（`locatePlaceForEvent`）：貼文有寫門牌就只用門牌查（Photon、Overpass，跟 `locatePlace` 同一套；Photon 搜「自立街 22」只回傳一樣是 22 號的，查不到時再查同一側的前後門牌（±2，沒有再 ±4）推算；Overpass 幾個鏡像站同時查、誰先回應用誰，最多等 18 秒；地點欄沒寫縣市時從另一欄補，兩欄都沒寫縣市但有區的，用 Nominatim 查這個區在哪個縣市（`cityOfDistrict`，全台只有一個同名區的才補，例如淡水區→新北市；東區、中正區這種好幾個縣市都有的不猜），縣市還是不確定就不查；Photon 的門牌 OSM 算在別的鄉鎮區時，離寫的那一區的這條路 2 公里內才用，區界上的路例如「臺南市中西區北門路一段55號」OSM 算在東區），查不到就先退到那條路（`geocodeStreet`：先含巷「北新路184巷」再大路「北新路」，Nominatim 只接受道路、名字要真的是那條路（`isRoadHit`，OSM 的公車站也算 highway，「新北市關新路」曾對到叫「八里行政中心」的公車站）、要在同一個縣市和鄉鎮區，快取鍵前面加 `road:`，`approx_area` 寫路名）；地點原文沒寫縣市（模型自己補的縣市，或根本沒有）時：門牌在那個縣市查不到，先用 Photon 查全台哪個縣市有這個門牌（`cityOfHouse`，只有一個縣市有的才用，例如模型補成新北市、新竹縣的「關新路186號」→新竹市）；那個縣市又查不到這條路時，查全台哪個縣市有這條路（`cityOfRoad`，只有一個縣市有的才用，例如關新路→新竹市，快取鍵 `city-of-road:`），改用那個縣市再查一次門牌和路，再退到鄉鎮區中心，都標成約略位置，**不拿店名或「XX服務處」去猜**（會查到同名的別的機構）；沒有門牌才用 Nominatim 查地名。固定據點的每天時段只定位一次；一則貼文的 Overpass 最多查 25 秒，之後只用 Photon。有門牌卻只定位到路或鄉鎮區的事件，排程每次挑 3 個地址重查（`relocateApprox`，同一個地址隔 3 小時、記在 `events.locate_checked_at`；門牌查不到快取一天），Overpass 恢復或 OSM 補了門牌、查到更準的位置就把那則貼文那個地點還沒結束的時段都改過去。
4. 事件狀態：`upcoming` → `active`（到開始時間）→ `ended`（到結束時間，或作者後續貼文／回覆出現「發完」等字眼）。
5. 前端向 `/api/events` 拿附近事件（開頁面、換位置、換模組、切回分頁且超過 2 分鐘時；清單上方點「↻ 更新」手動更新；自動更新預設關掉，可選每 1、5、10 分鐘，存在 `dr.poll`，分頁在背景時不抓。一直開著的網頁每次更新都算 Workers 的請求數，免費方案每天 10 萬次。伺服器把每個模組的事件暫存在 isolate、有新增或更新才重讀 D1，回應帶 ETag，沒變就回 304；車掃路線最多每 10 分鐘抓一次），用使用者座標算方位與距離畫在雷達上；進行中事件變多時嗶聲＋通知。

### 車掃路線

每 10 分鐘讀台北大洋流官網的「未來航線」與「大洋流車掃地圖」：

- 車掃地圖的頁面寫出車掃時間（例如「車掃 17:30–18:30」）與抵達後的活動（「市政開講 18:30–20:30 · 民權公園」），路段 API 給實際路徑與各段認領人數。官網的船票時間是出發時間，車掃地圖讀不到時才用它。
- 事件：起點（出發後保留 15 分鐘）、加油點（整天，到預計經過後 15 分鐘）、終點（抵達後的活動，沒有就保留 1 小時）。
- 加油點的預計經過時間：投影到路線上，用累計距離在出發到抵達之間等速推算。路段名稱有寫到的加油點直接用車掃地圖的座標，地址查到的離路線超過 60 m 就移到路線上。
- 新聞、Threads、使用者貼的連結講的是同一場車掃就併進官方那一場（`events.merged_into`）：類型是活動、提到車掃／掃街／洋流號／市政開講、同一天、提到同一區（松山、信義、松信）或路線上的地名，或在路線 1.5 km 內。每次排程重新比對，前端只在官方那一場列「相關報導」。
- 路線存在 `routes` 表，前端用 `/api/routes` 畫在雷達與地圖上（地圖依認領人數上色），清單合成一張「車掃」卡片與每站時間表。不顯示車隊即時位置（官方要大家不跟車）。

### 使用者回報貼文連結

使用者按「＋回報」貼上 Threads 貼文連結（Android 加到主畫面後也能從 Threads 直接分享），Worker 讀取該則貼文的公開嵌入頁 `https://www.threads.com/t/<代碼>/embed` 取得內文與作者，發文時間由貼文代碼推算（Instagram 編號前 41 位元是建立時間），再走同一套判讀流程，貼文 id 為 `link-<代碼>`。

- **先確認才上雷達**：判讀、定位完不寫進 `events`，先存在 `posts.confirm_plan`（`confirm_state = 'pending'`），回傳 `outcome: 'preview'`、`preview`（每個地點或時段一筆，固定據點的每天合成一筆，附定位結果）和 `confirm { postId, token }`（token 是貼文 id 加鹽雜湊）。回報的人按「對」打 `POST /api/reports/confirm` 才寫進雷達（寫之前再檢查一次有沒有結束、重複）；按「不對」打 `POST /api/reports/reject { note }`，`confirm_state = 'rejected'`、`confirm_note` 記哪裡錯，管理者用 `GET /api/admin/posts?confirm=rejected` 看，修好可以用 `.../reprocess` 重跑（直接上雷達）。還沒確認的貼文排程不會自己判讀；別人再貼同一則會再看到預覽、也能確認。貼文沒寫地點或時間時，回報的人可以 `POST /api/reports/supplement { postId, token, note }` 補充（200 字內，一則最多 5 次，算在同 IP 每小時的回報次數裡），存在 `posts.supplement`，判讀時接在貼文後面（「【回報的人補充】…」）再跑一次 AI；放上雷達後詳細資料會顯示「回報的人補充」。只寫行政區的地點（「中正萬華區」）不拿去查地圖，不然會被對到某個區的中心、看起來像精確位置。排程搜尋到的貼文、已確認貼文內容改了的重新判讀，照舊直接上雷達。雷達上已經有同地點（150 m 內）、還沒結束的固定據點時（`PlanItem.merge`）：同一個帳號的新貼文取代它（舊據點還沒開完的時段 `ended_reason = 'replaced'`，舊貼文 `posts.linked_to` 指向新貼文、`link_role = 'previous'`），別人的貼文不建事件、只附上去（`link_role = 'related'`，結果 `attached_to_<事件 id>`、outcome `attached`）；預覽的 `update` 先告訴回報的人會怎樣，詳細資料的 `related`（`role`）列出這些貼文。回報、確認、補充時帶 `x-device`（瀏覽器的隨機裝置代碼，跟漂流瓶同一組），加鹽雜湊存在 `submissions.device`（30 天後跟回報紀錄一起刪），回報的人可以 `GET /api/reports/mine` 列出、`DELETE /api/reports/:postId` 刪除自己的回報：這則的事件全刪、`confirm_state = 'withdrawn'`（之後有人再貼會重新判讀）；這則取代過舊據點的話，舊據點還沒過的時段放回雷達，附在這則的別人貼文改附回舊據點。
- 詳細資料（`/api/events` 的 `post.text`）只給原文摘錄（`postExcerpt`）：寫時間、日期、地點的幾行（不夠再補寫發什麼的），約 90 字，省略的地方寫「…」；新聞只給標題。全文只存在資料庫給判讀、重讀比對用，不回傳。
- 只收 7 天內的貼文；同一個瀏覽器（`x-device` 裝置代碼的加鹽雜湊）每小時 20 則，同一個 IP（加鹽雜湊）每小時 60 則（手機網路、同一個 Wi-Fi 常很多人共用一個 IP，所以放寬；沒帶裝置代碼的舊版網頁照以前 10 則），全站每小時 200 則；補充資料不算次數（一則最多補充 5 次）。到上限時回 429，訊息寫大約幾分鐘後可以再回報。
- 排程每 30 分鐘重讀還在雷達上的回報貼文：刪文就下架、改成「發完了」就結束、內容改了就重新判讀。
- 活動開始後，2 個不同的人按「回報已發完」就提早下架（官方行程除外）。
- 亂貼的貼文可用 `DELETE /api/admin/posts/link-<代碼>` 移除。

### 固定據點

店家、服務處連續好幾天都能去領的，一樣走「回報 Threads 貼文」（`/api/reports`）：AI 判讀時 `spot = true` 的場次展開成每天一筆（沒寫最後一天不預設哪天結束：先排到 14 天後，排程每 10 分鐘用 `extendOpenSpots` 往後補，同一則貼文、同一個地點、每天同一個時間算一串，這串還有沒結束的時段才補，最多到發文後 30 天（隱私權政策貼文最多留 30 天）；畫面寫「發完為止」。沒寫幾點結束開到當天結束）。寫「每週二、四」的只排那幾天：模型回 `weekdays`（1 = 週一 … 7 = 週日），漏掉時從貼文的「每週…」補（一定要有「每」，「10/21（週二）」這種日期註記不算），存在 `events.weekdays`，畫面寫「每週二、四 14:00–18:00」。模型給的最後一天（`until`）要在貼文或補充裡找得到那個日期（「10/29」「10月29日」「10/17~29」），找不到就當成沒寫（模型常自己填年底），畫面寫「發完為止」。

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

雷達分好幾層疊在一起（`web/src/radar.ts`），會動的都不放在主圖層：最下面是外框和底色；掃描只建目前主題那一種，扇形、指針是整層 div 用 CSS transform 轉，波紋是兩個 div 放大、變淡；擴散圈、掃到時的光暈和亮環是另一層 div（跟光點同位置、同 class，顏色照舊），只動 transform、opacity，都交給顯示晶片；漂流瓶的霧和可撿範圍在一層小 SVG；最上面是主圖層（格線、道路、輪廓、光點、文字，接觸控）。主圖層有一千多個元素，裡面只要有東西每一格在動，整層每一格都要重算樣式、排版、重畫，所以光點本體掃到時只分兩段變亮、進行中的閃爍每 0.6 秒換一次 class；每 40 毫秒（不是每一格畫面）看掃描動畫的進度決定哪些光點要閃，雷達有沒有顯示用 ResizeObserver 記著，不每一格量大小。2026-10-28 在無頭 Chrome 量的雷達待機主執行緒忙碌比例：預設主題 27.7% → 12.8%（波紋再放慢到每 2.5 秒一圈後 8.2%）、扇形 26% → 7.7%、指針 27% → 5.9%（CPU 慢 4 倍時 67% → 11%）。

## 關鍵字

- 預設搜尋「洋流飄帶」，由管理員用 `/api/admin/keywords` 新增或停用（管理員新增的會固定搜尋）。
- 一般使用者目前只能看到搜尋中的關鍵字，不能修改。等帳號綁定做好，把 `wrangler.toml` 的 `ALLOW_USER_KEYWORDS` 改成 `"true"` 就會開放：
  使用者可選擇追蹤哪些關鍵字、新增新的關鍵字；同時最多搜尋 10 個，使用者新增的 7 天沒人追蹤會自動停止。

## 手機介面

- 以手機直式為主：雷達占滿中間，底部是可上拉的清單面板，桌機則把清單放右側欄。
- 雷達左下可切 1 / 5 / 20 km、「雙北」「全台」「全球」範圍。從「全球」再用雙指、滾輪拉遠就是太空（`web/src/space.ts`，第一次用到才載入；沒有另外的按鈕、不用切換，最遠 50 億 km），跟雷達平常一樣用虛線畫在海岸線那一層、刻度圈照樣有（寫幾萬、幾億 km），太空裡一次縮放的幅度是平常的平方（從全球到海王星約 20 格滾輪）：先是以你為中心的地球（正射投影，陸地跟全球一樣淡淡填色、虛線海岸，經緯線每 30 度，夜晚的那一半照現在時間淡淡變暗；太陽直射點用簡化公式，誤差不到 1 度），剛超過全球時塞滿雷達，拉遠到 4 倍以後照真實比例（`globeFrac`），光點照球面擺、地球另一面的不畫，地球小到看不出光點在哪就不畫光點；陸地在另一面的那一段沿著地球邊緣走短的那邊（南北美洲連成一塊、繞過台灣正對面，照每個點走會把整個地球塗滿）。再拉遠是月球的軌道和月球（簡化公式），太陽、八大行星和軌道，加上地球和火星之間虛構的「汪星」（1.26 AU、約 1.4 年繞一圈；放大到看得出形狀就跟地球一樣畫成球：經緯線、虛線的邊，夜晚那一半照太陽真正的方向，正中間的經緯度跟著拖曳轉；表面的陸地寫在 `WOOF_LAND`，還沒規劃）（以地球為中心照真實距離，黃道面、春分點方向在右邊；行星位置用 JPL 的近似軌道根數，1800–2050 年適用，解克卜勒方程式），名字疊到就換位置。星球照真實大小畫（太小就畫最小的大小），線條跟雷達一樣、淡淡的顏色讓人認得出來，背對太陽的一半變暗：太陽有光芒、土星有環（後半圈被擋住）、天王星的環是直的、木星有條紋和大紅斑、海王星有暗斑、火星有極冠、月球有坑（放大後還有月海、更多坑）。位置每 10 分鐘更新；太空裡一樣可以拖曳移動位置，拖的是地球（手指拖過地球表面多遠就轉多少，照地球在雷達上的半徑換算），地球小到只剩一個點（`TINY_EARTH`，月球、行星那幾層）就改成 3D 轉視角（`SpaceView`：左右拖繞中心轉、上下拖傾斜，最多 80 度，拖過整個雷達的寬度轉半圈；位置、軌道都是 3D 的，含軌道傾角、月球軌道斜 5 度，遠的先畫，傾斜時軌道變成斜的橢圓；你的位置不變），點星球就飛過去當中心（`data-body`，點地球回到你），中心換到別的星球就一直維持、可以拉近到全球以內（例如月球，最多放大到星球半徑的 1.3 倍，不對齊範圍按鈕），你畫在地球那裡、寫「地球（你）」；光點不畫，「回到我的位置」會出現，按了回到地球、從正上方看（按範圍按鈕也是）；中心是你的時候拉近到看得出地球的形狀，轉過的視角自動轉回來；切到地圖再切回來是全球的比例。範圍比雙北小、50 km 內畫道路（選「雙北」和更大的範圍只畫虛線；人在雙北以外時雙北的半徑很大，所以門檻是雙北的半徑和 50 km 取小的，`outlineKm`，比它大就畫海岸線、縣市界，道路和虛線中間不會空一段）（`web/src/streets.ts`，第一次用到才載入）：用 [OpenFreeMap](https://openfreemap.org) 的向量圖磚（OpenMapTiles 格式，資料來自 OpenStreetMap；免費、不用金鑰，雷達下面標出處），先讀 TileJSON 拿到當週的圖磚網址；範圍越大用越粗一級的圖磚、畫的路越少（`STREET_TIERS`，圖磚寬度都大於畫面直徑，最多四張）：2 km 內 z13（約 4.4 km 寬，大街小巷：快速道路、主要幹道、次要幹道粗線，其他街道細線；z14 多了建築、門牌、店家，市區一張壓縮後就六百多 KB），8 km 內 z11（國道、快速道路粗線，主要、次要幹道細線），16 km 內 z10、33 km 內 z9（國道、快速道路粗線，主要幹道細線），再大 z8（只畫國道、快速道路）；一張壓縮後約 70–180 KB，最多記住 64 張。自己解讀 protobuf 只取 transportation 圖層，服務道路、步道、鐵路、隧道、施工中的不畫；顏色用雷達格線的顏色、很淡，跟著手機朝向轉，拖曳時每一幀用平面近似重算，粗線、細線各合成一條 path。「雙北」畫雙北縣市界；範圍比雙北大（全台、全球、縮放到比雙北遠）一律畫海岸線，1000 km 內再畫縣市在陸地上的交界（`web/src/counties.ts`，OpenStreetMap 22 個縣市的行政界去掉海岸線、海上的界線，© OpenStreetMap contributors，ODbL，簡化到約 250 m，跟世界海岸線一起第一次用到才載入，畫得比海岸線淡）：台灣用 `TAIWAN_RINGS`，加上全世界的（世界資料裡的台灣太粗，換掉），超出外圈的點不畫、斷開的線不填色。「全球」半徑約 20,040 km（地球另一面），用 Natural Earth 1:110m 的陸地海岸線（`web/src/world.ts`，公有領域，簡化到約 0.25 度、去掉南極洲和小島，第一次選才載入）畫虛線；雷達是以目前位置為中心的方位等距投影，相鄰兩點在畫面上離太遠就斷開不連線。範圍超過 600 km 時改抓全世界的事件（`/api/events` 的 `radius_km` 最大 20,040），一次最多回傳 1000 筆（固定據點每天一筆，200 筆時比較晚開始的會被擠掉）。「雙北」照台北市＋新北市的縣市界判斷（`web/src/shuangbei.ts`，OpenStreetMap 新北市行政界簡化，© OpenStreetMap contributors，ODbL），雷達與地圖畫出輪廓，基隆、桃園、宜蘭算雙北以外。「雙北」是預設；「雙北」「全台」的半徑會依你的位置自動算到能涵蓋整個區域（全台含澎湖、金門、馬祖）；右上可切換地圖、開啟指北針（雷達跟著手機朝向轉，iOS 會先問權限）。
- 清單上方是搜尋框（原本「搜尋中的關鍵字」那一列移到說明頁，說明頁從 `/api/keywords` 讀；完整的判讀規則面板用 `./?open=keywords` 打開）：在目前抓到的事件裡找字（標題、地點、物品、帳號、關鍵字、原文摘錄、補充、類型、車掃名稱；小寫、去空白、臺台不分，空白分開的每個字都要符合），雷達、地圖、清單、各類數量都只算符合的；開始時的通知不受搜尋影響；從「我的回報」「看」、推播打開不符合的那一則時自動清除搜尋。
- 雷達單指（或滑鼠）拖曳移動中心（`Radar` 的 `onPan`：移動超過 8 px 才算拖，螢幕位移換成方位與公里數，指北針模式加回手機朝向；拖到一半放第二根手指改成縮放；放開後的 click 不算點光點）。拖曳就是改「你的位置」成手動位置：拖的時候只重畫、範圍維持原本的公里數，放開才 `setOrigin`（存下來、重抓、雙北全台照新位置重算範圍）；手動位置時雷達左上出現「回到我的位置」：馬上回到最新的 GPS 位置，還沒收到 GPS（例如剛開頁面）就回到上次知道的位置（最後一次的 GPS 或移動前的位置，存在 `dr.home`；之後 GPS 回來照常更新），兩個都沒有才重新定位。
- 點光點、地圖標記或清單打開詳細資料；點其他地方只收起卡片，雷達、地圖、清單上照樣選著那一則（標題、選取圈，車掃的站照樣畫整條路線；5 秒重畫也不會再跳出來），再點它重新打開，按卡片的「關閉」才取消選取（`dismissedId`）。車掃時間表、地標、漂流瓶、疊在一起的選單點其他地方照舊整個關掉。
- 新事件開始時：嗶聲、震動（Android）、頁內橫幅，有授權時再加系統通知（透過 service worker `web/public/sw.js`，Android 的 Chrome 不允許頁面直接 `new Notification`）。聲音需要先按一次右上角「通知」。
- 手機推播（Web Push，網頁關掉也收得到）：開通知時瀏覽器支援就一起訂閱（iPhone 要 iOS 16.4 以上、加入主畫面後從主畫面打開），把推播訂閱和約略位置（小數點後 3 位）存進 `push_subscriptions`；網頁開著時移動超過 300 m 更新位置。排程每 10 分鐘 `pushStarted` 找剛開始（30 分鐘內開始、或剛放上雷達就已經開始）、還沒推過（`events.pushed_at`）的發放、活動（固定據點、整天的不推），推給 1 km 內的訂閱者，一個人一次合成一則；深夜 23:00–8:00 不推也不補推。內容依 RFC 8291 加密（aes128gcm），VAPID 金鑰第一次用到時產生、存在 `settings`（`vapid_private_jwk`、`vapid_public`），不用另外設定 secret。推播服務回 404、410 或 30 天沒打開網頁就刪掉訂閱。點通知打開 `./?event=<id>` 選到那一則（網頁開著就由 service worker 傳訊息過去）。
- 有 manifest 與圖示，可「加入主畫面」以全螢幕開啟。

## 模組（切換雷達）

同一套雷達、地圖、清單、搜尋、回報、回報管理，換不同主題的資料。點標題（`#module-btn`）切換，記在 `localStorage`（`dr.module`），網址 `?module=dog` 也可以。
- 後端：`worker/src/modules.ts`（`current` 洋流、`dog` 狗狗陪伴、`badminton` 羽球臨打、`food` 等一下吃什麼）；貼文記在 `posts.module`，事件跟著貼文（`/api/events?module=`、`POST /api/reports { url, module }`）；判讀說明照模組換（`ExtractSpec`：洋流用 `EVENT_SPEC`，狗狗陪伴用 `worker/src/jobs.ts` 的 `JOB_SPEC`）。還沒放上雷達的回報從別的模組再貼一次，會改成那個模組重新判讀。
- 前端：`web/src/modules.ts` 放每個模組的名稱、說明、空白時的說法、回報說明、判讀結果的說法、說明頁（洋流 `help.html`、狗狗陪伴 `help-dog.html`，標題列的「說明」照目前的模組打開）。洋流專屬的官方航線、車掃、漂流瓶、地標、搜尋關鍵字、類型開關、只看進行中、開始時推播，在其他模組不顯示。換模組時清掉選取、搜尋，第一次抓到的不算「新開始」（不會一次響一堆）。
- 羽球臨打（`worker/src/badminton.ts` 的 `SESSION_SPEC`，`kind = 'session'`）：收兩種，`extra.role` 是 `offer`（招臨打：球團開放名額，照洋流的場次排，每週固定的變成固定場，`extra` 放費用、程度、缺幾位、用球、球團、報名方式）或 `seek`（找臨打：球友想找地方打，`planSeeks` 當成刊登，寫了想打的時段顯示到那個時段結束，沒寫顯示 7 天，`extra` 放可以打的時間、程度）；畫面標「招臨打」「固定場」「找臨打」，清單的找臨打另外一段；「名額已滿」「臨打取消」「場地取消」會自動下架。說明頁 `help-badminton.html`。
- 等一下吃什麼（`worker/src/food.ts` 的 `FOOD_SPEC`，`kind = 'food'`）：`extra.role` 是 `vendor`（出攤：餐車、市集攤位，照場次排，每週固定的變固定擺攤）、`recommend`（網友推薦的店，刊登 14 天，沒有時間）、`meetup`（揪團吃飯，約的時段結束或 3 天）；`extra` 放店名、吃什麼、價位、營業時間、缺幾人、報名方式。畫面分「店家發布」（出攤、固定攤）和網友推薦、揪團吃飯兩段，揪團的詳細資料有跟網友吃飯的安全提醒。店家自己的優惠、限量、新開幕廣告不收。刊登（找臨打、推薦、揪團）共用 `planPostings`（`POSTING_DAYS`）。說明頁 `help-food.html`。
- 狗狗陪伴：收兩種刊登，`extra.role` 是 `hire`（徵人：飼主、店家找人照顧）或 `offer`（可照顧：個人說可以幫忙照顧、寄宿、遛狗，免費或收費；店家廣告不收），畫面標「徵人」「可照顧」；可照顧的只標「提到先付錢」，詳細資料顯示給飼主的安全提醒。判讀工作地點、工作期間、每天時段、薪資、雇主、怎麼應徵、內容，存在 `events.extra`（JSON），`kind = 'job'`。從發文起算「徵才中」，到工作期間最後一天（沒寫 14 天，最多發文後 30 天）。防詐提醒（`jobRisks`）：沒寫雇主（「僱主」「飼主」這種沒名字的不算）、只留表單、只加 LINE（沒有電話也沒有單位名稱）、提到保證金、先付款、提款卡、帳戶；每則都顯示防詐提醒，有可疑之處的清單標「⚠️ 注意」。作者把貼文改成「已徵到」「已額滿」「停止招募」等（`ENDED_WORDS`）會自動下架。

## 問題回報

詳細資料的「回報問題」：選類型（地點錯誤、時間錯誤、標題或內容錯誤、不是發放或活動、重複、車掃的刪除這一站、其他）加選填說明，存進 `event_feedback`（回報當時的標題、地點；裝置代碼與 IP 的加鹽雜湊，限制每小時次數、同一個人同一則同一種只算一次；30 天後刪除），馬上推到管理者手機（`admin_push_subscriptions`，同一個 tag，新的取代舊的但會再響）。管理頁 `web/admin.html`（Vite 的第二個入口，跟雷達共用小地圖；不公開連結；雷達側欄的版本字樣連點 5 下進去，存過 token 的會顯示「管理回報」連結）輸入一次 ADMIN_TOKEN（只存在那支手機的 localStorage），可以開回報通知、看未處理／已處理的回報、標成已處理，或直接套用：把說明（管理者可以先改，地點錯誤的預設加「地點：」、時間錯誤加「時間：」）加到貼文補充、重新判讀（`reprocessPost`），直接改標題（`setManualTitle`：同一個地點的每天時段一起改，`events.title_manual = 1`，畫面就用這個標題、不從地點拆店名，重新判讀也保留；AI 常常不照補充改標題），或從雷達下架（`takeDown`：不是發放活動的整則貼文，其他的只下架那一則，固定據點連同同一個地點的每天時段，車掃的一站連時間表、路線一起拿掉）；套用後自動標成已處理，管理頁列出現在雷達上這則貼文的事件；重新判讀後少了原本的地點會警告（補充只提到一個地點時 AI 常漏掉其他的）。回報的車掃（時間表的「回報問題」，或從某一站打開）可以選哪一站（預設那一站或整條路線），多一個「刪除這一站」（一定要選站）；時間表上沒有確切位置、還沒經過的站有「我知道在哪」，按了打開回報、先選好那一站和地點錯誤，一定要寫在哪裡（網頁和伺服器都擋），管理者在管理頁標好位置就放上雷達：`event_feedback.stop`、`stop_at` 記那一站的標題、預計經過時間，標題、地點寫那一站的，那一站在雷達上有點就掛在那個點，沒有（只有約略位置、已經經過）就掛在回報的那一則；管理頁寫出是哪一站，指定了站的回報用「刪除這一站」（`removeRouteStop`：從 `routes.stops` 拿掉、重新連線、第一站改成出發最後一站改成抵達、出發抵達時間跟著改，一站都不剩就刪掉路線，雷達上那一站的點下架），不顯示一般的下架（回報可能掛在別站的點上）；也可以「修改這一站的地點」（`setRouteStopPlace`）：欄位寫地址、店名按「查地點」（或 Enter，打 `POST /api/admin/locate { place }`，查法跟修改表單的「查地點」一樣）標到小地圖上，不對再拖標記或點地圖，也可以按「在地圖上標」直接點（灰點是這一站現在的位置，`/api/admin/feedback` 指定了站的回報附 `stop_lat`、`stop_lng`）；標了位置就送 `lat`、`lng`，欄位寫的當成地點名稱（空白保留原本的，送出前確認會寫成什麼），沒標才照欄位查（查到約略位置不算，或貼 Google 地圖按右鍵複製的「緯度, 經度」），地點錯誤的預先帶入回報的說明；切到別的分頁再回來列表會重新載入，標的位置、打開的地圖、還沒送出的欄位都會留著；路線那一站、連線、雷達上的點跟著改，原本沒放上雷達、車隊還沒經過的站放上去，其他站不動）。回報「地點錯誤」時表單多一張小地圖（灰點是現在的位置，車掃選了站就是那一站），點地圖或拖紅色標記標出正確位置，也可以寫地址、店名按「查地點」（`POST /api/events/:id/locate { place }`，查法跟修改表單一樣；同一個裝置每小時 20 次、同一個 IP 60 次，記在 settings 的 `flocate:`，兩小時前的順手清掉；查到確切位置就標上去，約略位置只移過去讓人自己點，說明沒寫就帶入查的地點）（選填，沒有確切位置的站寫說明或標位置擇一），存在 `event_feedback.pin_lat`、`pin_lng`，推播寫「在地圖上標了位置」；不會自己生效，管理頁把回報的人標的位置直接放上那筆回報的小地圖（紅色標記），管理者看過按「修改這一站的地點」（車掃）或「修改地點」（其他的，`event_place`：`setEventPlace`，同一則貼文同一個地點還沒結束的一起改，固定據點的每天時段也是，約略位置拿掉、找不到地點的放上雷達）。回報「時間錯誤」的，管理頁直接填開始、結束（台灣時間，預先帶現在的；結束空白是沒寫結束，排 2 小時）按「修改時間」（`event_time`：`setEventTime`，只改那一則）；車掃指定了站的填預計經過時間按「修改這一站的時間」（`stop_time`：`setRouteStopTime`，雷達上改成經過前 10 分到後 15 分，時間表照時間重新排、重新連線，原本已經經過、改到後面的有確切位置就放回雷達，同一站別人的回報 `stop_at` 跟著改）；已經過的時間、21 天以後的不行。手動改的地點、時間記在 `manual_fixes`（`savePlaceFix`、`saveTimeFix`：地點照判讀出來的地點文字去掉空白認，時間照同一個地點、判讀出來的開始時間認；改了又改的一起改，改了地點名稱的時間跟著換），重新判讀（補充後套用、`.../reprocess`、回報的貼文內容改了）時 `planActivities` 先套用（`applyManualFixes`：標的位置不再查地圖，車掃的站名照原本判讀的、地點寫改過的，手動標的不算「兩站同一點」的查錯；補充改了時間、AI 讀出別的開始時間就照新的），刪貼文、貼文過期時一起刪。管理頁的 API 網址固定，不接受網址參數，免得 token 被送到別的網站。同一個瀏覽器只有一個推播訂閱：雷達關掉附近通知時，管理頁的回報通知開著就不取消訂閱，反之亦然。

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
| POST | `/api/reports/edit` | 洋流的活動：直接改每一場 `{ postId, token, items: [{ title, startAt, endAt, place, lat, lng }] }`（不問 AI，有標位置用標的），回傳新的預覽 |
| POST | `/api/reports/reject` | 判讀錯了，不放 `{ postId, token, note? }` |
| GET | `/api/reports/mine` | 我的回報（`x-device` 標頭）：30 天內用這個瀏覽器回報、有放上雷達（或附在據點）的貼文與狀態 |
| DELETE | `/api/reports/:postId` | 刪除自己的回報（`x-device` 要跟回報時一樣）：雷達上這則的事件都刪掉，`confirm_state = 'withdrawn'`；取代過的舊據點放回雷達 |
| POST | `/api/events/:id/ended` | 回報已發完／已結束 |
| POST | `/api/events/:id/feedback` | 回報問題 `{ kind: location \| time \| content \| not_event \| duplicate \| remove_stop \| other, note?, stop?, stopAt? }`（`x-device` 標頭；車掃的 `stop` 是那一站的標題、`stopAt` 預計經過時間，`remove_stop` 一定要有），推到管理者手機；同一個人同一則（同一站）同一種只算一次 |
| GET | `/api/push/key` | 手機推播的 VAPID 公鑰、通知半徑 |
| POST | `/api/push/subscribe` | 訂閱推播或更新位置 `{ subscription, lat, lng }`（只接受 Google、Apple、Mozilla、Microsoft 的推播網址），第一次訂閱會送一則確認通知 |
| POST | `/api/push/unsubscribe` | 取消推播 `{ endpoint }` |
| GET | `/api/keywords` | 搜尋中的關鍵字、上限、是否開放使用者新增 |
| POST | `/api/keywords` | 使用者新增關鍵字（`ALLOW_USER_KEYWORDS` 為 true 才開放） |
| POST | `/api/admin/posts` | 手動塞貼文並立即解析 |
| POST | `/api/admin/ingest` | 立刻跑一次抓取與狀態更新 |
| GET | `/api/admin/events?status=` | 所有事件（含 ended、unlocated） |
| GET | `/api/admin/posts` | 最近 100 則原始貼文與解析結果 |
| DELETE | `/api/admin/posts/:id` | 刪除一則貼文與它的事件 |
| DELETE | `/api/admin/posts/:id/supplement` | 拿掉回報的人補充的資料（重複或寫錯），雷達上的事件不動 |
| POST | `/api/admin/posts/:id/supplement` | 管理者替貼文補充 `{ note }`（例如查到店名地址），再用 `.../reprocess` 重新判讀 |
| POST | `/api/admin/posts/:id/weekdays` | 固定據點只在每週幾開：`{ weekdays: [2, 3, 4, 5, 6, 7] }`（1 = 週一），其他天還沒結束的時段下架 |
| POST | `/api/admin/events/:id/locate` | 手動修正位置：`{ lat, lng }` 或 `{ query }`，加 `approx_area` 標成約略位置 |
| POST | `/api/admin/posts/:id/reprocess` | 用目前的規則重新判讀一則貼文（還沒結束的舊事件會先刪掉） |
| POST | `/api/admin/extract` | 只判讀不存檔，可指定 models 比較，`module` 指定用哪個模組的判讀（`dog`、`badminton`） |
| GET | `/api/admin/feedback?status=open\|resolved` | 問題回報列表（含事件現在的狀態、位置、原文連結） |
| POST | `/api/admin/feedback/:id` | 標成已處理或改回未處理 `{ status: 'resolved' \| 'open' }` |
| POST | `/api/admin/feedback/:id/apply` | 套用回報：`{ action: 'title', title }` 直接改標題、`{ action: 'supplement', note }` 補充後重新判讀，`{ action: 'takedown', scope: 'event' \| 'post' }` 從雷達下架，車掃指定了站的 `{ action: 'remove_stop' }` 刪除這一站、`{ action: 'stop_place', place, lat?, lng? }` 改這一站的地點（有 `lat`、`lng` 就用，`place` 當地點名稱；沒有就照 `place` 查）、`{ action: 'stop_time', start }` 改這一站的預計經過時間；不是車掃的 `{ action: 'event_place', place, lat?, lng? }` 改地點、`{ action: 'event_time', start, end? }` 改時間（unix 秒）；手動改的地點、時間重新判讀也保留；完成後標成已處理 |
| POST | `/api/admin/locate` | 管理頁小地圖查地點 `{ place }`，回 `{ found, lat, lng, name, approxArea }`（也收「緯度, 經度」） |
| POST | `/api/admin/push/subscribe`、`/unsubscribe` | 管理者手機開、關回報通知 `{ subscription }`、`{ endpoint }` |
| POST | `/api/admin/push-selftest` | 用 RFC 8291 的範例確認推播加密在 Workers 上正確，回傳訂閱數 |
| POST | `/api/admin/link-fetch` | 只讀取貼文連結的內容（確認讀得到），不判讀不存檔 |
| GET/POST/DELETE | `/api/admin/keywords[/:id]` | 關鍵字管理（新增的會固定搜尋） |
| GET/POST | `/api/admin/token` | 查看／更新 Threads token |

admin 路徑需要 `Authorization: Bearer <ADMIN_TOKEN>`。

換 ADMIN_TOKEN：裝置代碼、IP、回報確認代碼的雜湊用的鹽存在 `settings.hash_salt`（第一次用到時存當時的 ADMIN_TOKEN），之後跟 ADMIN_TOKEN 無關，換 token 不會讓「我的回報」、漂流瓶、還沒確認的預覽對不上。換之前先確認 `POST /api/admin/push-selftest` 回傳 `hashSaltStored: true`；換完管理頁要用新的 token 重新登入。

## 之後可以做的

- Web Push：目前通知只在頁面開著時出現，背景推播需要 Service Worker + VAPID。
- 關鍵字管理介面。
- 用 Claude API 取代 Workers AI 做抽取，準確度更高。
- 指北針模式：用 DeviceOrientation 讓雷達跟著手機方向轉。
