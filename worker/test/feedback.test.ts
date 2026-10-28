import { describe, expect, it } from 'vitest';
import { cleanNote, feedbackMessage } from '../src/feedback';

describe('cleanNote', () => {
  it('trims, collapses spaces and caps at 200 characters', () => {
    expect(cleanNote('  實際在   2 號出口\n旁邊 ')).toBe('實際在 2 號出口 旁邊');
    expect(cleanNote('   ')).toBeNull();
    expect(cleanNote(123)).toBeNull();
    expect([...(cleanNote('洋'.repeat(300)) ?? '')]).toHaveLength(200);
  });
});

describe('feedbackMessage', () => {
  it('says what was reported and how many are still open', () => {
    const m = feedbackMessage({ kind: 'location', title: '棲木咖啡發飄帶', note: '實際在 2 號出口' }, 3);
    expect(m).toMatchObject({ title: '新回報：地點錯誤（未處理 3 則）', body: '棲木咖啡發飄帶｜實際在 2 號出口', tag: 'feedback', url: './admin.html', renotify: true });
    expect(feedbackMessage({ kind: 'other', title: 't', note: null }, 1)).toMatchObject({ title: '新回報：其他', body: 't｜沒寫說明' });
    expect(feedbackMessage({ kind: 'remove_stop', title: '沈麼啦車掃・中正服務處', note: '這站取消了' }, 1)).toMatchObject({ title: '新回報：刪除這一站', body: '沈麼啦車掃・中正服務處｜這站取消了' });
  });
});
