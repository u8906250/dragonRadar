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

export function systemNotify(title: string, body: string): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, tag: `dragon-radar-${title}` });
  } catch {
    /* 某些行動瀏覽器不允許頁面直接建立通知 */
  }
}
