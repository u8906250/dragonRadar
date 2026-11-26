import { describe, expect, it } from 'vitest';
import { normalizeTaipai, TAIPAI_SPEC, taipaiHints, taipaiPrompt, taipaiSpec } from '../src/taipai';
import { cleanTaipaiWord, SEED_TAIPAI_WORDS, taipaiWordLists, taipaiWordStatuses } from '../src/taipaiWords';

const store = { name: '慢工咖啡', type: 'cafe', hours: null, place_text: '師大路 100 號', place_query: null, from_profile: ['taipai', 'hours'], confidence: 0.9 };

describe('台派用詞', () => {
  it('writes the adopted and rejected words into the prompt', () => {
    const p = taipaiPrompt({ adopted: ['台派', '抗中保台'], rejected: ['民主'] });
    expect(p).toContain('貼文寫到這些（或意思一樣的說法）就算台派：「台派」「抗中保台」');
    expect(p).toContain('管理者決定不算台派的說法：「民主」；只靠這些說法（或意思一樣的說法）看不出是台派，taipai 填 false');
    expect(p).toContain('"taipai_by": taipai 為 true 時，判成台派的依據');
    expect(p).toMatch(/店家在店裡發飄帶（也寫成「漂帶」[^\n]*也算台派/);
    // 原本判讀說明裡的例子先列成採用
    expect(TAIPAI_SPEC.system).toContain('就算台派：「台派」「挺台」「顧台灣」「台灣價值」「台灣主權」「民主」「飄帶」');
    expect(TAIPAI_SPEC.system).not.toContain('不算台派的用詞');
  });
  it('drops the ribbon rule when ribbons no longer count', () => {
    const p = taipaiPrompt({ adopted: ['台派'], rejected: ['飄帶'] });
    expect(p).not.toContain('店家在店裡發飄帶');
    expect(p).not.toContain('或寫了店裡發飄帶');
    expect(p).toContain('簡介寫了這家店是台派、挺台灣，也算台派');
  });
  it('keeps the word a store was judged taipai by', () => {
    const r = normalizeTaipai({ is_event: true, taipai: true, reason: null, taipai_by: '「抗中 保台」', tags: [], events: [store] });
    expect(r).toMatchObject({ is_event: true, taipai_word: '抗中保台', reason: null });
    expect(r).not.toHaveProperty('not_taipai');
    // 看不出是台派：沒有依據
    expect(normalizeTaipai({ is_event: true, taipai: false, reason: '沒寫是台派', taipai_by: '台派', tags: [], events: [store] })).not.toHaveProperty('taipai_word');
  });
  it('sends stores judged by a rejected word to the admin', () => {
    const r = taipaiSpec({ adopted: ['台派'], rejected: ['飄帶'] }).normalize({ is_event: true, taipai: true, reason: null, taipai_by: '飄帶', tags: [], events: [store] });
    expect(r).toMatchObject({ is_event: true, not_taipai: true, reason: '「飄帶」管理者決定不算台派' });
    expect(r).not.toHaveProperty('taipai_word');
    // 「台派是從簡介讀的」也不成立
    expect(r?.events[0].extra).toMatchObject({ from_profile: ['hours'] });
    // 採用的、還沒決定的照判讀
    expect(taipaiSpec({ adopted: ['台派'], rejected: ['飄帶'] }).normalize({ is_event: true, taipai: true, reason: null, taipai_by: '顧台灣', tags: [], events: [store] })).toMatchObject({ taipai_word: '顧台灣' });
  });
  it('cleans the word', () => {
    expect(cleanTaipaiWord(' #台派 ')).toBe('台派');
    expect(cleanTaipaiWord('')).toBeNull();
    expect(cleanTaipaiWord(null)).toBeNull();
    expect(cleanTaipaiWord('一二三四五六七八九十一二三四')).toBe('一二三四五六七八九十一二');
  });
  it('reads the words from the database, or the seed words when it cannot', async () => {
    const rows = [
      { word: '台派', status: 'adopted' },
      { word: '民主', status: 'rejected' },
      { word: '飄帶', status: 'adopted' },
    ];
    const stmt = { bind: () => stmt, all: async () => ({ results: rows }) };
    expect(await taipaiWordLists({ DB: { prepare: () => stmt } } as never)).toEqual({ adopted: ['台派', '飄帶'], rejected: ['民主'] });
    const broken = { DB: { prepare: () => ({ all: async () => Promise.reject(new Error('no such table')) }) } } as never;
    expect(await taipaiWordLists(broken)).toEqual(SEED_TAIPAI_WORDS);
  });
  it('picks words that might mean taipai for the admin (v1.780)', () => {
    const p = taipaiPrompt({ adopted: ['台派'], rejected: [] });
    expect(p).toContain('"taipai_hints": is_event 為 true、taipai 為 false 時');
    expect(TAIPAI_SPEC.schema).toMatchObject({ required: expect.arrayContaining(['taipai_hints']) });
    // 店家自己帳號的表態貼文（回家投票、放小卡）也算介紹這家店
    // 店家自己的帳號發的貼文不一定要介紹自己（表態、公告、在店裡辦的活動都算這家店，v1.853）
    expect(p).toContain('店家自己的帳號發的貼文，內容不一定要介紹自己');
    expect(p).toContain('在自己店裡辦的活動（例如放映、直播放送、講座、聚會）都算這家店');
    // 看不出是台派：抓的說法整理好（去掉引號、重複、管理者決定不算的，最多 3 個）
    const spec = taipaiSpec({ adopted: ['台派'], rejected: ['民主'] });
    const r = spec.normalize({ is_event: true, taipai: false, reason: '沒寫是台派', taipai_by: null, taipai_hints: ['「回家投票」', '回家投票', '民主', '守護 台灣', '台灣加油', '龜山島'], tags: [], events: [store] });
    expect(r).toMatchObject({ not_taipai: true, taipai_hints: ['回家投票', '守護台灣', '台灣加油'] });
    // 判成台派的不用抓
    expect(spec.normalize({ is_event: true, taipai: true, reason: null, taipai_by: '台派', taipai_hints: ['回家投票'], tags: [], events: [store] })).not.toHaveProperty('taipai_hints');
    // 沒抓到（或舊的輸出沒有這一欄）就沒有
    expect(spec.normalize({ is_event: true, taipai: false, reason: '沒寫是台派', taipai_by: null, tags: [], events: [store] })).not.toHaveProperty('taipai_hints');
    expect(taipaiHints(['好', null, 3, '挺台'])).toEqual(['挺台']);
  });
  it('looks up what the admin decided about those words', async () => {
    let asked: unknown[] = [];
    const stmt = { bind: (...a: unknown[]) => ((asked = a), stmt), all: async () => ({ results: [{ word: '回家投票', status: 'rejected' }] }) };
    const got = await taipaiWordStatuses({ DB: { prepare: () => stmt } } as never, ['回家投票', '守護台灣']);
    expect(asked).toEqual(['回家投票', '守護台灣']);
    expect(got.get('回家投票')).toBe('rejected');
    expect(got.has('守護台灣')).toBe(false);
    expect((await taipaiWordStatuses({ DB: { prepare: () => { throw new Error('no query'); } } } as never, [])).size).toBe(0);
  });
});
