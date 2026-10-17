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
  THREADS_ACCESS_TOKEN?: string;
  /** Threads App ID（App 設定 > 基本資料裡的 Threads 應用程式編號） */
  THREADS_APP_ID?: string;
  /** Threads App 密鑰，只能放在 secret */
  THREADS_APP_SECRET?: string;
  ADMIN_TOKEN?: string;
}
