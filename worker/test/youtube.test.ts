import { describe, expect, it } from 'vitest';
import { linkPostId, youtubeIdOf } from '../src/reports';
import { cleanYoutubeText, parseYoutubePostHtml, parseYoutubePostUrl } from '../src/sources/youtube';
// 2026-11-24 抓的 YouTube 社群貼文頁（沈伯洋Puma 的市民之夜），只留 JSON-LD（前面多放一個別的 JSON-LD）
import post from './fixtures/youtube-post.html?raw';

describe('YouTube 社群貼文的連結（v1.806）', () => {
  it('finds post links, with share params or from the channel community tab', () => {
    expect(parseYoutubePostUrl('https://youtube.com/post/UgkxZWKbAGFTcq7j2GLIF_4fZ6XIMJpQ2vjk?si=AIoI0H_0aTxQNOHW')).toEqual({ id: 'UgkxZWKbAGFTcq7j2GLIF_4fZ6XIMJpQ2vjk' });
    expect(parseYoutubePostUrl('看這個 https://www.youtube.com/post/UgkxZWKbAGFTcq7j2GLIF_4fZ6XIMJpQ2vjk')).toEqual({ id: 'UgkxZWKbAGFTcq7j2GLIF_4fZ6XIMJpQ2vjk' });
    expect(parseYoutubePostUrl('https://m.youtube.com/post/UgkxZWKbAGFTcq7j2GLIF_4fZ6XIMJpQ2vjk')).toEqual({ id: 'UgkxZWKbAGFTcq7j2GLIF_4fZ6XIMJpQ2vjk' });
    expect(parseYoutubePostUrl('https://www.youtube.com/@PumaShen/community?lb=UgkxZWKbAGFTcq7j2GLIF_4fZ6XIMJpQ2vjk')).toEqual({ id: 'UgkxZWKbAGFTcq7j2GLIF_4fZ6XIMJpQ2vjk' });
    expect(parseYoutubePostUrl('https://www.youtube.com/channel/UC123abc/posts?app=desktop&lb=UgkxZWKbAGFTcq7j2GLIF_4fZ6XIMJpQ2vjk')).toEqual({ id: 'UgkxZWKbAGFTcq7j2GLIF_4fZ6XIMJpQ2vjk' });
  });
  it('skips videos and other pages', () => {
    expect(parseYoutubePostUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseYoutubePostUrl('https://youtu.be/dQw4w9WgXcQ')).toBeNull();
    expect(parseYoutubePostUrl('https://www.youtube.com/@PumaShen/community')).toBeNull();
    expect(parseYoutubePostUrl('https://www.threads.com/@x/post/Df9XWDpoAZF')).toBeNull();
  });
});

describe('YouTube 社群貼文的頁面', () => {
  it('reads the full text, exact publish time and channel handle from the JSON-LD', () => {
    const r = parseYoutubePostHtml(post);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.username).toBe('PumaShen');
    expect(r.author).toBe('沈伯洋Puma');
    expect(r.postedAt).toBe(Math.floor(Date.parse('2026-11-23T22:30:00.182+08:00') / 1000));
    expect(r.text.startsWith('選前之夜，\n是屬於市民的夜晚。\n\n從參選到現在')).toBe(true);
    expect(r.text).toContain('🗓️ 11/27（五）18:00－22:00\n📍 仁愛路大道（國父紀念館側）');
    expect(r.text.endsWith('#你的市長沈伯洋')).toBe(true);
    expect(r.text).not.toMatch(/[⁨⁩⠀]/);
  });
  it('treats a page without the post data (consent, bot check) as a read error', () => {
    expect(parseYoutubePostHtml('<html><body>Before you continue to YouTube</body></html>').status).toBe('error');
  });
  it('cleans the invisible characters and blank lines', () => {
    expect(cleanYoutubeText('⁨第一行\n⠀\n⠀\n\n第二行  \n⁩')).toBe('第一行\n\n第二行');
  });
});

describe('YouTube 貼文的貼文 id', () => {
  const envWith = (rows: Array<{ id: string; module: string }>): never => {
    let binds: string[] = [];
    const stmt = {
      bind: (...b: string[]) => ((binds = b), stmt),
      all: async () => ({ results: rows.filter((r) => binds.includes(r.id)) }),
    };
    return { DB: { prepare: () => stmt } } as never;
  };
  it('uses yt- and a radar suffix like Threads posts', async () => {
    expect(await linkPostId(envWith([]), 'UgkxZWKbAGFTcq7j2GLIF_4fZ6XIMJpQ2vjk', 'current', 'yt')).toBe('yt-UgkxZWKbAGFTcq7j2GLIF_4fZ6XIMJpQ2vjk');
    expect(await linkPostId(envWith([{ id: 'yt-Ugkx_abc-123', module: 'food' }]), 'Ugkx_abc-123', 'current', 'yt')).toBe('yt-Ugkx_abc-123.current');
    expect(youtubeIdOf('yt-Ugkx_abc-123.current')).toBe('Ugkx_abc-123');
    expect(youtubeIdOf('yt-UgkxZWKbAGFTcq7j2GLIF_4fZ6XIMJpQ2vjk')).toBe('UgkxZWKbAGFTcq7j2GLIF_4fZ6XIMJpQ2vjk');
  });
});
