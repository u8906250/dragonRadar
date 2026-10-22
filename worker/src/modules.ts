/**
 * 模組：同一套雷達、地圖、清單、回報，換不同主題的資料。
 * current 洋流（發放、活動、固定據點，加上官方航線、新聞）；dog 狗狗陪伴（徵人照顧、陪伴、遛狗的職缺）。
 * 每則貼文記在一個模組（posts.module），事件跟著貼文；判讀說明照模組換。
 */
export type ModuleId = 'current' | 'dog';

export const MODULE_IDS: readonly ModuleId[] = ['current', 'dog'];
export const DEFAULT_MODULE: ModuleId = 'current';

export const isModule = (v: unknown): v is ModuleId => typeof v === 'string' && (MODULE_IDS as readonly string[]).includes(v);
export const moduleOf = (v: unknown): ModuleId => (isModule(v) ? v : DEFAULT_MODULE);
