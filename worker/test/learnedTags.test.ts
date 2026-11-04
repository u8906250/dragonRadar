import { describe, expect, it } from 'vitest';
import { MODULE_TAGS, postTags } from '../src/extract';
import { manualTags } from '../src/learnedTags';

describe('手動加的關鍵字', () => {
  it('keeps only what the reporter added: not judged, not a built-in common word, no repeats', () => {
    // 判讀出來 #洋流 #飄帶，回報的人加了 #寶可夢、#彩虹（彩虹是洋流寫死的常見詞，不用記）、拿掉 #飄帶
    expect(manualTags('current', ['洋流', '寶可夢', '彩虹', '寶可夢'], ['洋流', '飄帶'])).toEqual(['寶可夢']);
    // 沒有加新的
    expect(manualTags('current', ['洋流'], ['洋流', '飄帶'])).toEqual([]);
    // 每個雷達自己的常見詞
    expect(manualTags('work', ['發文宣', '派報'], [])).toEqual(['派報']);
  });
  it('adopted words tag later posts that mention them, like the built-in common words', () => {
    const adopted = ['寶可夢'];
    expect(postTags([], '週六在中山公園有寶可夢聚會', [...MODULE_TAGS.current, ...adopted])).toContain('寶可夢');
    // 內文沒寫到的不標
    expect(postTags([], '週六在中山公園有聚會', [...MODULE_TAGS.current, ...adopted])).not.toContain('寶可夢');
  });
});
