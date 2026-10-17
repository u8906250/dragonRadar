export interface Env {
  DB: D1Database;
  AI: Ai;
  ALLOWED_ORIGINS: string;
  MOCK_MODE: string;
  THREADS_API_BASE: string;
  NOMINATIM_USER_AGENT: string;
  AI_MODEL: string;
  DEFAULT_RADIUS_KM: string;
  /** "true" 才開放一般使用者新增關鍵字；等帳號綁定做好再打開 */
  ALLOW_USER_KEYWORDS?: string;
  THREADS_ACCESS_TOKEN?: string;
  ADMIN_TOKEN?: string;
}
