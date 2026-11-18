import { describe, expect, it } from 'vitest';
import { accountName, deviceLabel, RP_ID, rpFor } from '../src/account';

describe('passkey 網域', () => {
  const allowed = 'https://current-radar.pages.dev,https://u8906250.github.io,http://localhost:5173';
  it('uses current-radar.pages.dev for the site and its preview deployments', () => {
    expect(RP_ID).toBe('current-radar.pages.dev');
    expect(rpFor('https://current-radar.pages.dev', allowed)).toEqual({ rpID: RP_ID, origin: 'https://current-radar.pages.dev' });
    expect(rpFor('https://abc123.current-radar.pages.dev', allowed)).toEqual({ rpID: RP_ID, origin: 'https://abc123.current-radar.pages.dev' });
  });
  it('allows localhost only when it is in ALLOWED_ORIGINS', () => {
    expect(rpFor('http://localhost:5173', allowed)).toEqual({ rpID: 'localhost', origin: 'http://localhost:5173' });
    expect(rpFor('http://localhost:5199', allowed)).toBeNull();
  });
  it('refuses other sites (github.io is not kept), lookalikes and junk', () => {
    expect(rpFor('https://u8906250.github.io', allowed)).toBeNull();
    expect(rpFor('https://evilcurrent-radar.pages.dev', allowed)).toBeNull();
    expect(rpFor('https://current-radar.pages.dev.evil.com', allowed)).toBeNull();
    expect(rpFor('http://current-radar.pages.dev', allowed)).toBeNull();
    expect(rpFor('https://current-radar.pages.dev/', allowed)).toBeNull();
    expect(rpFor('null', allowed)).toBeNull();
    expect(rpFor(null, allowed)).toBeNull();
  });
});

describe('帳號、裝置的名字', () => {
  it('names the device from the User-Agent', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1')).toBe('iPhone · Safari');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1')).toBe('iPhone · Chrome');
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36')).toBe('Android · Chrome');
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15')).toBe('Mac · Safari');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0')).toBe('Windows · Edge');
    expect(deviceLabel('Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0')).toBe('Linux · Firefox');
    expect(deviceLabel('')).toBe('瀏覽器');
  });
  it('names the account from the first 3 bytes of its user handle', () => {
    // AAEC… 是 0x00 0x01 0x02 開頭
    expect(accountName('AAECAwQFBgcICQoLDA0ODw')).toBe('活動雷達 #000102');
    expect(accountName('_-_-AAAAAAAAAAAAAAAAAA')).toMatch(/^活動雷達 #[0-9A-F]{6}$/);
  });
});
