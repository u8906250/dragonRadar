type OrientationEvt = DeviceOrientationEvent & { webkitCompassHeading?: number };

interface PermissionCapable {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

export function compassSupported(): boolean {
  return 'DeviceOrientationEvent' in window;
}

/**
 * 訂閱手機朝向。iOS 要先在使用者手勢內要權限；Android 優先用 absolute 事件。
 * 回傳取消訂閱的函式；拿不到權限回 null。
 */
export async function startCompass(onHeading: (deg: number) => void): Promise<(() => void) | null> {
  if (!(await askPermission())) return null;
  let last: number | null = null;
  const handler = (ev: Event): void => {
    const h = headingOf(ev as OrientationEvt);
    if (h === null) return;
    if (last !== null && Math.abs(((h - last + 540) % 360) - 180) < 2) return;
    last = h;
    onHeading(h);
  };
  const type = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  window.addEventListener(type, handler);
  return () => window.removeEventListener(type, handler);
}

/** iOS 要先在使用者手勢內要權限（其他瀏覽器不用）；拿不到回 false */
async function askPermission(): Promise<boolean> {
  if (!compassSupported()) return false;
  const ctor = window.DeviceOrientationEvent as unknown as PermissionCapable;
  if (typeof ctor.requestPermission !== 'function') return true;
  try {
    return (await ctor.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/** 手機背面朝哪（度，北 0、東 90）：iOS 有 webkitCompassHeading，其他用 alpha */
function headingOf(e: OrientationEvt): number | null {
  if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) return e.webkitCompassHeading;
  if (e.alpha !== null && e.alpha !== undefined) return (360 - e.alpha) % 360;
  return null;
}

/**
 * 手機朝向（v1.802 3D 國館的指北針跟著手機轉）：每次感測器有新值都回 heading（背面朝哪，度）和 beta（前後傾，直立 90、往後仰大於 90、平放 0）；
 * 不篩掉小變化（畫面自己慢慢跟上）。回傳取消訂閱的函式；拿不到權限回 null
 */
export async function startOrientation(on: (heading: number, beta: number) => void): Promise<(() => void) | null> {
  if (!(await askPermission())) return null;
  const handler = (ev: Event): void => {
    const e = ev as OrientationEvt;
    const h = headingOf(e);
    if (h === null || e.beta === null || e.beta === undefined) return;
    on(h, e.beta);
  };
  const type = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  window.addEventListener(type, handler);
  return () => window.removeEventListener(type, handler);
}
