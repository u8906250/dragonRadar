/**
 * 收店家的雷達（台派雷達、書店雷達）共用：每個雷達自己的店家類型。
 * 類型的 key 各雷達不重複，所以分享連結、補充說明照 key 查名稱就好（STORE_TYPE_NAMES）。
 */
import { BOOK_TYPES } from './books';
import type { ModuleId } from './modules';
import { STORE_TYPES } from './taipai';

/** 這個雷達的店家類型（判讀、修改表單只能選這些） */
export const storeTypesOf = (module: ModuleId): Record<string, string> => (module === 'books' ? BOOK_TYPES : STORE_TYPES);
/** 是這個雷達的店家類型 */
export const isStoreTypeOf = (module: ModuleId, v: unknown): v is string => typeof v === 'string' && Object.prototype.hasOwnProperty.call(storeTypesOf(module), v);
/** 所有雷達的店家類型的名稱 */
export const STORE_TYPE_NAMES: Record<string, string> = { ...STORE_TYPES, ...BOOK_TYPES };
