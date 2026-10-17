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

function tone(ctx: AudioContext, freq: number, at: number, dur: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.18, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** 龍珠雷達式的兩聲嗶 */
export function beep(): void {
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  tone(audio, 1046, t, 0.12);
  tone(audio, 1568, t + 0.18, 0.16);
}

let bannerTimer: number | undefined;
export function showBanner(el: HTMLElement, text: string, ms = 8000): void {
  el.textContent = text;
  el.hidden = false;
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

export function systemNotify(title: string, body: string): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, tag: `dragon-radar-${title}` });
  } catch {
    /* 某些行動瀏覽器不允許頁面直接建立通知 */
  }
}
