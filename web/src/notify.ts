import type { SoundStyle } from './themes';

let audio: AudioContext | null = null;

/** 瀏覽器要求先有使用者互動才能出聲，按鈕 click 時呼叫 */
export function unlockAudio(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

function tone(ctx: AudioContext, opts: { type: OscillatorType; freq: number; to?: number; at: number; dur: number; gain?: number }): void {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.freq, opts.at);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, opts.at + opts.dur);
  g.gain.setValueAtTime(0.0001, opts.at);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.18, opts.at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, opts.at + opts.dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(opts.at);
  osc.stop(opts.at + opts.dur + 0.02);
}

/** 依主題播提示音 */
export function beep(style: SoundStyle = 'beep'): void {
  if (!audio || audio.state !== 'running') return;
  const ctx = audio;
  const t = ctx.currentTime;
  switch (style) {
    case 'sonar':
      tone(ctx, { type: 'sine', freq: 1400, to: 700, at: t, dur: 0.6, gain: 0.2 });
      tone(ctx, { type: 'sine', freq: 1400, to: 700, at: t + 0.7, dur: 0.5, gain: 0.07 });
      break;
    case 'wood':
      tone(ctx, { type: 'triangle', freq: 240, to: 160, at: t, dur: 0.09, gain: 0.3 });
      tone(ctx, { type: 'triangle', freq: 240, to: 160, at: t + 0.16, dur: 0.09, gain: 0.3 });
      break;
    case 'synth':
      tone(ctx, { type: 'sawtooth', freq: 523, at: t, dur: 0.1, gain: 0.12 });
      tone(ctx, { type: 'sawtooth', freq: 659, at: t + 0.11, dur: 0.1, gain: 0.12 });
      tone(ctx, { type: 'sawtooth', freq: 784, at: t + 0.22, dur: 0.18, gain: 0.12 });
      break;
    default:
      tone(ctx, { type: 'square', freq: 1046, at: t, dur: 0.12 });
      tone(ctx, { type: 'square', freq: 1568, at: t + 0.18, dur: 0.16 });
  }
}

let bannerTimer: number | undefined;
export function showBanner(el: HTMLElement, text: string, ms = 2500): void {
  el.textContent = text;
  el.hidden = false;
  el.onclick = () => {
    window.clearTimeout(bannerTimer);
    el.hidden = true;
  };
  window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => {
    el.hidden = true;
  }, ms);
}

export function notificationState(): 'unsupported' | NotificationPermission {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

let swReg: ServiceWorkerRegistration | null = null;

/** 註冊 service worker：手機推播、Android 的系統通知都要靠它。點通知時它會傳要看的事件過來 */
export async function registerServiceWorker(onShowEvent: (id: number) => void): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    swReg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
    navigator.serviceWorker.addEventListener('message', (e: MessageEvent<{ type?: string; id?: number }>) => {
      if (e.data?.type === 'show-event' && Number(e.data.id)) onShowEvent(Number(e.data.id));
    });
  } catch {
    swReg = null;
  }
}

/** tag 一樣的通知會取代，不會重複跳（跟推播的同一則事件用同一個 tag） */
export function systemNotify(title: string, body: string, tag: string): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  // Android 的 Chrome 不允許頁面直接 new Notification，要透過 service worker
  if (swReg) {
    void swReg.showNotification(title, { body, tag, icon: `${import.meta.env.BASE_URL}icon-192.png` }).catch(() => undefined);
    return;
  }
  try {
    new Notification(title, { body, tag });
  } catch {
    /* 某些行動瀏覽器不允許頁面直接建立通知 */
  }
}

/** 這個瀏覽器能不能收手機推播（iPhone 要加入主畫面、從主畫面打開才有） */
export function pushSupported(): boolean {
  return !!swReg && 'PushManager' in window && 'Notification' in window;
}

/** iPhone、iPad 的 Safari 分頁（還沒加入主畫面） */
export function iosNeedsHomeScreen(): boolean {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

function b64urlBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** 目前的推播訂閱；create 時沒有就訂閱。伺服器金鑰換過的舊訂閱重新訂閱 */
export async function pushSubscription(key: string, create: boolean): Promise<PushSubscription | null> {
  if (!swReg || !pushSupported()) return null;
  const want = b64urlBytes(key);
  let cur = await swReg.pushManager.getSubscription();
  const curKey = cur?.options.applicationServerKey ? new Uint8Array(cur.options.applicationServerKey) : null;
  if (cur && curKey && (curKey.length !== want.length || curKey.some((b, i) => b !== want[i]))) {
    await cur.unsubscribe().catch(() => false);
    cur = null;
  }
  if (cur || !create) return cur;
  return swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
}

/** 取消推播訂閱，回傳原本的 endpoint（沒有訂閱就是 null） */
export async function unsubscribePush(): Promise<string | null> {
  const cur = swReg ? await swReg.pushManager.getSubscription().catch(() => null) : null;
  if (!cur) return null;
  await cur.unsubscribe().catch(() => false);
  return cur.endpoint;
}
