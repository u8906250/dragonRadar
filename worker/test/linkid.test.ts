import { describe, expect, it } from 'vitest';
import { linkPostId, threadsCodeOf } from '../src/reports';

/** 假的 D1：posts 裡有這些（id、module） */
const envWith = (rows: Array<{ id: string; module: string }>): never => {
  let binds: string[] = [];
  const stmt = {
    bind: (...b: string[]) => ((binds = b), stmt),
    all: async () => ({ results: rows.filter((r) => binds.includes(r.id)) }),
  };
  return { DB: { prepare: () => stmt } } as never;
};

describe('同一則 Threads 貼文在每個雷達各記一筆（v1.773）', () => {
  it('the first radar keeps the plain id', async () => {
    expect(await linkPostId(envWith([]), 'Df9XWDpoAZF', 'books')).toBe('link-Df9XWDpoAZF');
    expect(await linkPostId(envWith([{ id: 'link-Df9XWDpoAZF', module: 'books' }]), 'Df9XWDpoAZF', 'books')).toBe('link-Df9XWDpoAZF');
  });
  it('another radar gets its own id, even after the first one is gone', async () => {
    expect(await linkPostId(envWith([{ id: 'link-Df9XWDpoAZF', module: 'taipai' }]), 'Df9XWDpoAZF', 'books')).toBe('link-Df9XWDpoAZF.books');
    expect(await linkPostId(envWith([{ id: 'link-Df9XWDpoAZF', module: 'taipai' }, { id: 'link-Df9XWDpoAZF.current', module: 'current' }]), 'Df9XWDpoAZF', 'current')).toBe('link-Df9XWDpoAZF.current');
    // 第一筆被清掉了：這個雷達之前記的照樣用
    expect(await linkPostId(envWith([{ id: 'link-Df9XWDpoAZF.books', module: 'books' }]), 'Df9XWDpoAZF', 'books')).toBe('link-Df9XWDpoAZF.books');
  });
  it('reads the Threads code back', () => {
    expect(threadsCodeOf('link-Df9X-WD_poAZF.books')).toBe('Df9X-WD_poAZF');
    expect(threadsCodeOf('link-Df9XWDpoAZF')).toBe('Df9XWDpoAZF');
    expect(threadsCodeOf('spot-Df9XWDpoAZF')).toBe('Df9XWDpoAZF');
  });
});
