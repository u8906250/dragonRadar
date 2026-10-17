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
  if (!compassSupported()) return null;
  const ctor = window.DeviceOrientationEvent as unknown as PermissionCapable;
  if (typeof ctor.requestPermission === 'function') {
    try {
      if ((await ctor.requestPermission()) !== 'granted') return null;
    } catch {
      return null;
    }
  }
  let last: number | null = null;
  const handler = (ev: Event): void => {
    const e = ev as OrientationEvt;
    let h: number | null = null;
    if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading;
    else if (e.alpha !== null && e.alpha !== undefined) h = (360 - e.alpha) % 360;
    if (h === null) return;
    if (last !== null && Math.abs(((h - last + 540) % 360) - 180) < 2) return;
    last = h;
    onHeading(h);
  };
  const type = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  window.addEventListener(type, handler);
  return () => window.removeEventListener(type, handler);
}
