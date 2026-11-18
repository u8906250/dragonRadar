/**
 * 帳號（選用，passkey 登入）：選單「說明」裡的「帳號」。不登入照樣能用；建立帳號、登入時這台的卡冊、道具、願望、漂流瓶、我的回報併進帳號，
 * 登入同一個帳號的裝置看到同一份（伺服器 worker/src/account.ts）。passkey 用手機、電腦的指紋、臉或螢幕鎖確認，不用 email、密碼。
 * passkey 綁網域：只有 current-radar.pages.dev（和它的預覽網址）、本機能用。登入、登出後重新整理頁面，各處的資料重新抓
 */
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { accountDelete, accountDeletePasskey, accountLoginOptions, accountLoginVerify, accountLogout, accountRegisterOptions, accountRegisterVerify, accountToken, fetchAccount, setAccountToken, type AccountInfo } from './api';

/** passkey 綁的網域（跟 worker 的 RP_ID 一樣） */
export const RP_HOST = 'current-radar.pages.dev';
const rpHere = (): string | null => {
  const h = location.hostname;
  if (h === RP_HOST || h.endsWith(`.${RP_HOST}`)) return RP_HOST;
  return h === 'localhost' ? 'localhost' : null;
};

/** 登入後才有的「有沒有資料」記號：設起來，開頁面時才會去抓我的回報、漂流瓶、願望的進度（帳號裡可能有別台的） */
const HAS_FLAGS = ['dr.reported', 'dr.bottleDropped', 'dr.wished'];

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function day(sec: number): string {
  const d = new Date(sec * 1000);
  const opts: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return new Intl.DateTimeFormat('zh-TW', opts).format(d);
}

/** passkey 跳出來之後沒完成：照原因寫給使用者看 */
function ceremonyMessage(e: unknown): string {
  const err = e as { name?: string; code?: string; message?: string };
  if (err.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return '這台的密碼管理員已經有這個帳號的 passkey 了';
  if (err.code === 'ERROR_INVALID_DOMAIN' || err.code === 'ERROR_INVALID_RP_ID' || err.name === 'SecurityError') return `這個網址不能用 passkey，請到 ${RP_HOST} 登入`;
  if (err.name === 'NotAllowedError' || err.code === 'ERROR_CEREMONY_ABORTED') return '沒有完成（取消了、逾時，或這台沒有這個網站的 passkey）';
  return `passkey 沒有完成：${err.message ?? '不明原因'}`;
}

/** 通知密碼管理員：這把 passkey 伺服器已經不認了（刪掉了），可以從清單拿掉；瀏覽器不支援就算了 */
async function forget(rpID: string, ids: string[]): Promise<void> {
  try {
    const { sendSignal } = await import('@simplewebauthn/browser');
    for (const credentialID of ids) await sendSignal({ signalName: 'unknownCredential', rpID, credentialID }).catch(() => undefined);
  } catch {
    /* 不支援 */
  }
}

/**
 * 在 box 裡畫帳號：沒登入（說明、建立帳號、登入）或登入了（帳號名稱、passkey、登入中的裝置、登出、刪除帳號）。
 * resync：登入、登出後重新整理頁面前，先把這個瀏覽器存的卡、道具照伺服器重存（cards.ts）
 */
export function mountAccount(box: HTMLElement, resync: () => Promise<void>): void {
  const rpID = rpHere();
  if (!rpID) {
    box.innerHTML = `<p>帳號（passkey 登入）只能在 <a href="https://${RP_HOST}/">${RP_HOST}</a> 用。</p>`;
    return;
  }
  const msg = (text: string, bad = false): void => {
    const m = box.querySelector<HTMLElement>('.tc-move-msg');
    if (!m) return;
    m.textContent = text;
    m.classList.toggle('bad', bad);
  };
  const busy = (on: boolean): void => box.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = on));
  /** 登入、登出了：卡、道具照伺服器重存、記號照登入狀態，重新整理頁面 */
  const switched = async (loggedIn: boolean, text: string): Promise<void> => {
    msg(text);
    busy(true);
    await resync().catch(() => undefined);
    try {
      for (const k of HAS_FLAGS) {
        if (loggedIn) localStorage.setItem(k, '1');
        else localStorage.removeItem(k);
      }
    } catch {
      /* 不能存就算了 */
    }
    location.reload();
  };

  const loggedOut = (note = ''): void => {
    const supported = typeof window.PublicKeyCredential === 'function';
    const inApp = /FBAN|FBAV|Instagram|Barcelona|Threads|Line\/|MicroMessenger/i.test(navigator.userAgent);
    box.innerHTML = `${note ? `<p class="tc-acct-note">${esc(note)}</p>` : ''}
      <p>不用帳號也能用。建立帳號後，這台的卡冊、道具、願望、漂流瓶（收藏、我丟的）和我的回報會存進帳號，換手機、用電腦登入同一個帳號就看得到同一份。</p>
      <p>登入用 <b>passkey</b>：用手機或電腦的指紋、臉或螢幕鎖確認，不用 email、密碼。伺服器只存 passkey 的公鑰，不知道你是誰。</p>
      ${
        !supported
          ? '<p class="tc-acct-note">這個瀏覽器不能用 passkey，請用新版的 Safari、Chrome 或 Edge 開啟。</p>'
          : inApp
            ? '<p class="tc-acct-note">在 App 裡開的網頁可能不能用 passkey，不行的話請用 Safari 或 Chrome 開啟。</p>'
            : ''
      }
      <div class="tc-acct-actions"><button type="button" class="chip primary" data-create${supported ? '' : ' disabled'}>建立帳號</button><button type="button" class="chip" data-login${supported ? '' : ' disabled'}>登入</button></div>
      <p class="tc-acct-small">已經有帳號：按「登入」，選「活動雷達 #…」。電腦上沒有的話，可以用手機掃畫面上的 QR code 登入。</p>
      <p class="tc-move-msg" role="status"></p>`;
  };

  const loggedIn = (a: AccountInfo): void => {
    const keys = a.passkeys
      .map(
        (k) =>
          `<li><span>${esc(k.label)}</span><small>${k.synced ? '已同步到雲端' : '只存在建立的那台'} · ${day(k.createdAt)} 建立${k.lastUsedAt && k.lastUsedAt !== k.createdAt ? ` · ${day(k.lastUsedAt)} 用過` : ''}</small>${
            a.passkeys.length > 1 ? `<button type="button" class="chip" data-del-key="${esc(k.id)}">刪除</button>` : ''
          }</li>`,
      )
      .join('');
    const devs = a.devices.map((d) => `<li><span>${esc(d.label)}${d.current ? '（這台）' : ''}</span><small>${day(d.lastUsedAt)}</small></li>`).join('');
    box.innerHTML = `<p>已登入 <b>${esc(a.name)}</b>（${day(a.createdAt)} 建立）。卡冊、道具、願望、漂流瓶和我的回報都存在帳號裡，登入同一個帳號的裝置看到同一份。</p>
      <h3>passkey</h3>
      <ul class="tc-acct-list">${keys}</ul>
      <div class="tc-acct-actions"><button type="button" class="chip" data-add-key>在這台加一把 passkey</button></div>
      <p class="tc-acct-small">用手機掃 QR code 登入的電腦、另一個牌子的手機，可以加一把存在那台的，下次直接用那台登入。</p>
      <h3>登入中的裝置</h3>
      <ul class="tc-acct-list">${devs}</ul>
      <div class="tc-acct-actions">${a.devices.length > 1 ? '<button type="button" class="chip" data-logout-others>登出其他裝置</button>' : ''}<button type="button" class="chip" data-logout>登出這台</button><button type="button" class="chip tc-acct-danger" data-delete>刪除帳號</button></div>
      <p class="tc-move-msg" role="status"></p>`;
  };

  const load = async (): Promise<void> => {
    if (!accountToken()) return loggedOut();
    box.innerHTML = '<p>讀取中…</p>';
    const r = await fetchAccount();
    if (!r.ok) {
      box.innerHTML = `<p class="tc-move-msg bad">${esc(r.message)}</p><div class="tc-acct-actions"><button type="button" class="chip" data-reload>再試一次</button></div>`;
      return;
    }
    if (r.data.account) return loggedIn(r.data.account);
    // 在別台按了「登出其他裝置」、帳號刪掉了、太久沒用：這台已經登出，存的卡、道具照伺服器重存
    setAccountToken(null);
    await resync().catch(() => undefined);
    loggedOut('這台已經登出了（可能在別的裝置登出了這台，或帳號刪除了）。');
  };

  /** 建立帳號（沒登入）或在這台加一把 passkey（登入了） */
  const register = async (): Promise<void> => {
    const adding = !!accountToken();
    busy(true);
    msg('');
    const o = await accountRegisterOptions<PublicKeyCredentialCreationOptionsJSON>();
    if (!o.ok) {
      busy(false);
      return msg(o.message, true);
    }
    let response;
    try {
      const { startRegistration } = await import('@simplewebauthn/browser');
      response = await startRegistration({ optionsJSON: o.data.options });
    } catch (e) {
      busy(false);
      return msg(ceremonyMessage(e), true);
    }
    msg('確認中…');
    const v = await accountRegisterVerify(o.data.flow, response);
    if (!v.ok) {
      busy(false);
      return msg(v.message, true);
    }
    if (v.data.token) {
      setAccountToken(v.data.token);
      return switched(true, '帳號建立好了，重新整理中…');
    }
    if (adding && v.data.account) {
      loggedIn(v.data.account);
      msg('加好了');
    }
  };

  /** 用 passkey 簽一次：登入、刪除帳號前確認共用。404 是伺服器不認得這把（刪掉了）：通知密碼管理員拿掉 */
  const sign = async <T>(send: (flow: string, response: unknown) => Promise<{ ok: true; data: T } | { ok: false; message: string; status?: number }>): Promise<T | null> => {
    const o = await accountLoginOptions<PublicKeyCredentialRequestOptionsJSON>();
    if (!o.ok) {
      msg(o.message, true);
      return null;
    }
    let response;
    try {
      const { startAuthentication } = await import('@simplewebauthn/browser');
      response = await startAuthentication({ optionsJSON: o.data.options });
    } catch (e) {
      msg(ceremonyMessage(e), true);
      return null;
    }
    msg('確認中…');
    const v = await send(o.data.flow, response);
    if (!v.ok) {
      if (v.status === 404) void forget(o.data.options.rpId ?? rpID, [response.id]);
      msg(v.message, true);
      return null;
    }
    return v.data;
  };

  box.addEventListener('click', async (e) => {
    const t = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!t || t.disabled) return;
    if (t.matches('[data-reload]')) return void load();
    if (t.matches('[data-create], [data-add-key]')) return void register();
    if (t.matches('[data-login]')) {
      busy(true);
      msg('');
      const d = await sign(accountLoginVerify);
      if (!d) return busy(false);
      setAccountToken(d.token);
      return void switched(true, '登入了，重新整理中…');
    }
    if (t.matches('[data-del-key]')) {
      const id = t.dataset.delKey ?? '';
      if (!confirm('刪除這把 passkey？刪掉之後就不能用它登入（其他的照常）。')) return;
      busy(true);
      const r = await accountDeletePasskey(id);
      if (!r.ok) {
        busy(false);
        return msg(r.message, true);
      }
      void forget(rpID, [id]);
      if (r.data.account) loggedIn(r.data.account);
      return msg('刪掉了');
    }
    if (t.matches('[data-logout-others]')) {
      if (!confirm('登出其他所有裝置？那些裝置要再登入才看得到帳號裡的東西。')) return;
      busy(true);
      const r = await accountLogout(true);
      if (!r.ok) {
        busy(false);
        return msg(r.message, true);
      }
      if (r.data.account) loggedIn(r.data.account);
      return msg('其他裝置都登出了');
    }
    if (t.matches('[data-logout]')) {
      if (!confirm('登出這台？帳號裡的卡冊、道具、願望、漂流瓶和我的回報這台就看不到了，再登入就回來。')) return;
      busy(true);
      const r = await accountLogout();
      // 已經被登出了（401）也一樣清掉
      if (!r.ok && r.status !== 401) {
        busy(false);
        return msg(r.message, true);
      }
      setAccountToken(null);
      return void switched(false, '登出了，重新整理中…');
    }
    if (t.matches('[data-delete]')) {
      if (!confirm('刪除帳號？帳號和 passkey 會從伺服器刪掉，帳號裡的卡冊、道具、願望、漂流瓶和我的回報搬回這台（跟沒有帳號時一樣），其他裝置就看不到了。\n\n接下來請用這個帳號的 passkey 確認。')) return;
      busy(true);
      msg('');
      const d = await sign(accountDelete);
      if (!d) return busy(false);
      await forget(d.rpID, d.passkeys);
      setAccountToken(null);
      return void switched(false, '帳號刪除了，重新整理中…');
    }
  });
  void load();
}
