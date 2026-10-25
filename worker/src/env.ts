export interface Env {
  DB: D1Database;
  AI: Ai;
  ALLOWED_ORIGINS: string;
  MOCK_MODE: string;
  THREADS_API_BASE: string;
  NOMINATIM_USER_AGENT: string;
  AI_MODEL: string;
  /** 主要模型判讀失敗或亂碼時用的備用模型 */
  AI_MODEL_FALLBACK?: string;
  DEFAULT_RADIUS_KM: string;
  /** "true" 才開放一般使用者新增關鍵字；等帳號綁定做好再打開 */
  ALLOW_USER_KEYWORDS?: string;
  /** Threads 關鍵字搜尋的審核狀態："review" 審核中、"approved" 已通過，只影響說明頁文字 */
  THREADS_SEARCH_STATUS?: string;
  /** "false" 時回報的固定據點全部改人工審核（有人亂貼時用）；沒設就是自動審核 */
  SPOT_AUTO_REVIEW?: string;
  /** "false" 時關掉漂流瓶（有人亂丟時用） */
  BOTTLES_ENABLED?: string;
  /** "false"：排程不自動抓資料（Threads 關鍵字搜尋、新聞、官方航線與合併），資料只從使用者回報來 */
  AUTO_SOURCES?: string;
  /** 使用者回報收哪些模組："true"（或沒設）全部、"false" 全部鎖住、或列出模組（"current,food"）；鎖住的不收貼連結回報、確認、補充、回報已發完、意見回饋 */
  REPORTS_ENABLED?: string;
  /** 版號，部署時用 --var 帶入（v1.<提交次數>） */
  APP_VERSION?: string;
  /** Apify API token（試用第三方 Threads 爬蟲用，只放 secret） */
  APIFY_TOKEN?: string;
  THREADS_ACCESS_TOKEN?: string;
  /** Threads App ID（App 設定 > 基本資料裡的 Threads 應用程式編號） */
  THREADS_APP_ID?: string;
  /** Threads App 密鑰，只能放在 secret */
  THREADS_APP_SECRET?: string;
  ADMIN_TOKEN?: string;
}
