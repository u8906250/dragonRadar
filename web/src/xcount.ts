/**
 * 字數比照 X（Twitter）：上限 280，拉丁字母、數字、一般標點算 1，中日韓文字、全形字、表情符號算 2
 * （一整個表情組合算一個字）。所以中文最多 140 字、英文最多 280 字。
 * 伺服器 worker/src/bottles.ts 用同一套算法。
 */
export const X_MAX_WEIGHT = 280;

const light = (cp: number): boolean =>
  cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037);

export function xLength(text: string): number {
  const t = text.normalize('NFC');
  const parts =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? Array.from(new Intl.Segmenter('zh-Hant', { granularity: 'grapheme' }).segment(t), (s) => s.segment)
      : Array.from(t);
  let n = 0;
  for (const g of parts) {
    const cps = Array.from(g);
    n += cps.length === 1 && light(cps[0].codePointAt(0) ?? 0) ? 1 : 2;
  }
  return n;
}
