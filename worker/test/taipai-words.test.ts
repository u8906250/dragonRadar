import { describe, expect, it } from 'vitest';
import { normalizeTaipai, TAIPAI_SPEC, taipaiPrompt, taipaiSpec } from '../src/taipai';
import { cleanTaipaiWord, SEED_TAIPAI_WORDS, taipaiWordLists } from '../src/taipaiWords';

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
});
