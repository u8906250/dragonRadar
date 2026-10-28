import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * 版號：v1.<提交次數>，每次提交自動加一，不用手動改；另外附上提交日期（台灣時間）與提交代碼。
 * CI 要用 fetch-depth: 0 拿完整歷史，次數才對；拿不到 git 時是 dev。
 */
function gitVersion(): { version: string; date: string; sha: string } {
  const git = (cmd: string): string => execSync(`git ${cmd}`, { env: { ...process.env, TZ: 'Asia/Taipei' } }).toString().trim();
  try {
    return { version: `v1.${git('rev-list --count HEAD')}`, date: git('log -1 --format=%cd --date=format-local:%Y-%m-%d'), sha: git('rev-parse --short HEAD') };
  } catch {
    return { version: 'dev', date: '', sha: '' };
  }
}

const VERSION = gitVersion();

/** 輸出 version.json，給說明頁讀，也方便確認線上是哪一版 */
const versionJson = (): Plugin => ({
  name: 'version-json',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(VERSION) });
  },
});

// GitHub Pages 的專案頁面要掛在 /<repo>/ 底下，CI 會把 VITE_BASE 設成 /dragonRadar/
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  build: {
    target: 'es2022',
    sourcemap: false,
    // 管理頁也打包（用雷達的小地圖），網址照舊是 admin.html
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        admin: fileURLToPath(new URL('admin.html', import.meta.url)),
      },
    },
  },
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  plugins: [versionJson()],
});
