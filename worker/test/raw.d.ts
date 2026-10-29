/** vitest（Vite）的 ?raw 匯入：檔案內容是字串（測試讀 migration 用） */
declare module '*?raw' {
  const text: string;
  export default text;
}
