import { describe, expect, it } from 'vitest';
import { b64urlDecode, b64urlEncode, encryptPayload, isPushEndpoint, isQuietHour, planPushes, vapidAuthorization, type PushSubRow, type StartedEvent } from '../src/push';

describe('encryptPayload', () => {
  // RFC 8291 附錄 A 的範例
  it('matches the RFC 8291 example', async () => {
    const out = await encryptPayload(
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
      'BTBZMqHH6r4Tts7J_aSIgg',
      new TextEncoder().encode('When I grow up, I want to be a watermelon'),
      {
        asPrivateB64: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
        asPublicB64: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
        saltB64: 'DGv6ra1nlYgDCS1FRnbzlw',
      },
    );
    expect(b64urlEncode(out)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });
});

describe('vapidAuthorization', () => {
  it('signs an ES256 JWT for the push service origin', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const pub = b64urlEncode(new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer));
    const h = await vapidAuthorization({ privateKey: pair.privateKey, publicKey: pub }, 'https://fcm.googleapis.com/fcm/send/abc', 1000);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h);
    expect(m).not.toBeNull();
    const [, head, body, sig, k] = m as RegExpExecArray;
    expect(k).toBe(pub);
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(body)))).toMatchObject({ aud: 'https://fcm.googleapis.com', exp: 1000 + 12 * 3600 });
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, b64urlDecode(sig), new TextEncoder().encode(`${head}.${body}`));
    expect(ok).toBe(true);
  });
});

describe('isPushEndpoint', () => {
  it('only accepts known push services over https', () => {
    expect(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(isPushEndpoint('https://web.push.apple.com/QF8x')).toBe(true);
    expect(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true);
    expect(isPushEndpoint('http://fcm.googleapis.com/x')).toBe(false);
    expect(isPushEndpoint('https://evil.example.com/fcm.googleapis.com')).toBe(false);
    expect(isPushEndpoint('https://fcm.googleapis.com.evil.com/x')).toBe(false);
  });
});

describe('isQuietHour', () => {
  const at = (hhmm: string) => Date.parse(`2026-10-22T${hhmm}:00+08:00`) / 1000;
  it('is quiet from 23:00 to 08:00 Taipei time', () => {
    expect(isQuietHour(at('22:59'))).toBe(false);
    expect(isQuietHour(at('23:00'))).toBe(true);
    expect(isQuietHour(at('03:00'))).toBe(true);
    expect(isQuietHour(at('07:59'))).toBe(true);
    expect(isQuietHour(at('08:00'))).toBe(false);
  });
  it("uses the subscriber's own time zone", () => {
    // 台灣 10/22 15:00 是加州 10/22 00:00（夏令時間 UTC-7）
    expect(isQuietHour(at('15:00'), 'America/Los_Angeles')).toBe(true);
    expect(isQuietHour(at('03:00'), 'America/Los_Angeles')).toBe(false);
  });
});

describe('planPushes', () => {
  const sub = (lat: number, lng: number): PushSubRow => ({ endpoint: `https://fcm.googleapis.com/${lat},${lng}`, p256dh: 'k', auth: 'a', lat, lng });
  const ev = (id: number, lat: number, lng: number, kind = 'giveaway', title = `t${id}`): StartedEvent => ({ id, kind, title, place_text: `p${id}`, lat, lng, approx_area: null });
  it('sends one message per subscriber for events within 1 km, nearest first', () => {
    const me = sub(25.0478, 121.517);
    const far = sub(25.1, 121.6);
    const plans = planPushes([me, far], [ev(1, 25.05, 121.517), ev(2, 25.0479, 121.5171, 'activity', '市場開講'), ev(3, 25.07, 121.517)]);
    expect(plans).toHaveLength(1);
    expect(plans[0].sub).toBe(me);
    expect(plans[0].msg.title).toBe('附近 2 個發放、活動開始了');
    expect(plans[0].msg.body).toMatch(/^市場開講｜p2｜\d+ 公尺，還有 t1$/);
    expect(plans[0].msg.url).toBe('./?event=2');
  });
  it('says what started when there is only one', () => {
    const plans = planPushes([sub(25.0478, 121.517)], [ev(5, 25.05, 121.517, 'activity')]);
    expect(plans[0].msg.title).toBe('活動開始');
    expect(plans[0].msg.tag).toBe('ev-5');
  });
});
