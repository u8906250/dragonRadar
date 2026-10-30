import { describe, expect, it } from 'vitest';
import { dogSvg, MALTESE, STILL, dogHeight, type DogLook } from '../src/dog';
import { Dog, DOG_SPEED, dogById, dogPose, type DogYard } from '../src/dogs';

/** 一塊 40 公尺見方的草皮（緯經度當公尺用，1 度 = 1 公尺） */
const YARD: DogYard = {
  anywhere: (rand) => ({ ring: 0, at: [rand() * 40, rand() * 40] }),
  within: (_ring, rand) => [rand() * 40, rand() * 40],
  metres: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
};
const seeded = (seed: number) => (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

describe('會動的狗（dogs.ts）', () => {
  it('walks slowly, runs, stops, sniffs and sits, one piece after another', () => {
    const rand = seeded(11);
    const dog = new Dog('test-a', MALTESE, YARD);
    expect(dogById('test-a')).toBe(dog);
    dog.place(rand, 0);
    // 十分鐘，每半秒看一次：一段接一段（沒有跳），停著的不動，走、跑照速度，每一段一開始面向上一段的方向
    const segs = new Map<number, NonNullable<Dog['seg']>>();
    for (let t = 0; t <= 600_000; t += 500) {
      const d = dog.now(t, rand);
      segs.set(d.seg.start, d.seg);
    }
    const list = [...segs.values()].sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++) {
      const [s, prev] = [list[i], list[i - 1]];
      expect(s.start).toBeCloseTo(prev.start + prev.ms, 6);
      expect(s.from).toEqual(prev.to);
      expect(s.dir0).toEqual(prev.dir);
      if (s.do === 'walk' || s.do === 'run') {
        expect(YARD.metres(s.from, s.to) / (s.ms / 1000)).toBeCloseTo(DOG_SPEED[s.do], 6);
        expect(s.dir).toEqual([s.to[0] - s.from[0], s.to[1] - s.from[1]]);
      } else {
        expect(s.to).toEqual(s.from);
        expect(s.dir).toEqual(s.dir0);
      }
    }
    expect(new Set(list.map((s) => s.do))).toEqual(new Set(['stand', 'sniff', 'sit', 'walk', 'run']));
    // 走路慢慢走
    expect(DOG_SPEED.walk).toBeLessThanOrEqual(0.3);
  });

  it('turns to face you (south) and sits when tapped, and sits longer when tapped again', () => {
    const rand = seeded(5);
    const dog = new Dog('test-b', MALTESE, YARD);
    dog.place(rand, 0);
    const before = dog.now(20_000, rand);
    dog.pet(20_000);
    const d = dog.now(20_100, rand);
    expect(d.seg.do).toBe('sit');
    expect(d.seg.pet).toBe(true);
    expect(d.at).toEqual(before.at);
    expect(d.seg.dir[0]).toBeLessThan(0);
    expect(d.seg.dir[1]).toBe(0);
    // 先轉身再坐下，坐好時吐舌頭搖尾巴，最後站起來
    expect(dogPose(d.seg, 100).sit).toBe(0);
    expect(dogPose(d.seg, 2000).sit).toBe(1);
    expect(dogPose(d.seg, 2000).tongue).toBe(true);
    expect(dogPose(d.seg, d.seg.ms).sit).toBe(0);
    const end = d.seg.start + d.seg.ms;
    dog.pet(23_000);
    expect(dog.now(23_100, rand).seg.start).toBe(20_000);
    expect(dog.seg!.start + dog.seg!.ms).toBeGreaterThan(end);
  });
});

describe('3D 的狗（dog.ts）', () => {
  /** 畫出來的部位照畫的順序（遠的先畫） */
  const order = (svg: string): string[] => [...svg.matchAll(/data-part="([^"]+)"/g)].map((m) => m[1]);
  /** 所有座標的範圍 */
  const box = (svg: string): [number, number, number, number] => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const m of svg.matchAll(/cx="([-\d.]+)" cy="([-\d.]+)"/g)) {
      xs.push(Number(m[1]));
      ys.push(Number(m[2]));
    }
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };

  it('can face any way: side, towards you, away from you', () => {
    const k = 400;
    const right = dogSvg(MALTESE, STILL, 90, k);
    const left = dogSvg(MALTESE, STILL, 270, k);
    // 面向右邊：鼻子在右邊；面向左邊左右相反
    const nose = (svg: string): number => Number(/data-part="nose"><ellipse cx="([-\d.]+)"/.exec(svg)![1]);
    expect(nose(right)).toBeGreaterThan(0.2 * k);
    expect(nose(left)).toBeCloseTo(-nose(right), 0);
    // 面向你：兩隻眼睛、鼻子畫在頭前面；背對你：眼睛、鼻子被頭擋住（先畫）
    const front = order(dogSvg(MALTESE, STILL, 180, k));
    for (const p of ['eye1', 'eye-1', 'nose']) expect(front.indexOf(p)).toBeGreaterThan(front.indexOf('head'));
    const back = order(dogSvg(MALTESE, STILL, 0, k));
    for (const p of ['eye1', 'eye-1', 'nose']) expect(back.indexOf(p)).toBeLessThan(back.indexOf('head'));
    // 側面（面向右邊）：右邊的眼睛看得到、左邊的被頭擋住
    const side = order(right);
    expect(side.indexOf('eye-1')).toBeGreaterThan(side.indexOf('head'));
    expect(side.indexOf('eye1')).toBeLessThan(side.indexOf('head'));
    // 正面比側面窄
    const [b1, b2] = [box(right), box(dogSvg(MALTESE, STILL, 180, k))];
    expect(b2[2] - b2[0]).toBeLessThan((b1[2] - b1[0]) * 0.75);
  });

  it('draws fur like grass, more hairs when bigger', () => {
    const hairs = (k: number): number => (dogSvg(MALTESE, STILL, 90, k).match(/Q/g) ?? []).length;
    expect(hairs(400)).toBeGreaterThan(350);
    expect(hairs(30)).toBeLessThan(hairs(400) / 3);
    expect(hairs(30)).toBeGreaterThan(50);
  });

  it('sits down lower, nods to sniff and shows its tongue', () => {
    const k = 400;
    const top = (svg: string): number => box(svg)[1];
    const headY = (svg: string): number => Number(/data-part="head"><ellipse cx="[-\d.]+" cy="([-\d.]+)"/.exec(svg)![1]);
    // 坐下：頭比站著低一點點（身體往上轉、往下坐），腳掌還在地上
    const sat = dogSvg(MALTESE, { ...STILL, sit: 1 }, 90, k);
    expect(Math.abs(headY(sat) - headY(dogSvg(MALTESE, STILL, 90, k)))).toBeLessThan(0.05 * k);
    expect(sat).toContain('data-part="leghlthigh"');
    // 聞：頭低下去
    expect(headY(dogSvg(MALTESE, { ...STILL, nod: 30 }, 90, k))).toBeGreaterThan(headY(dogSvg(MALTESE, STILL, 90, k)) + 0.01 * k);
    expect(top(dogSvg(MALTESE, STILL, 90, k))).toBeLessThan(-0.3 * k);
    expect(dogSvg(MALTESE, { ...STILL, tongue: true }, 180, k)).toContain('data-part="tongue"');
    expect(dogSvg(MALTESE, STILL, 180, k)).not.toContain('data-part="tongue"');
  });

  it('draws other dogs from their look', () => {
    const shiba: DogLook = { ...MALTESE, name: '柴犬', size: 1.4, fur: ['#f3c48a', '#d98c3f', '#a5622a'], ear: '#d98c3f', hair: 0.012, curl: 0.1, ears: 'prick', tail: 'straight', muzzle: 0.05 };
    const svg = dogSvg(shiba, STILL, 90, 300);
    expect(svg).toContain('#d98c3f');
    expect(svg).not.toContain('#f1ece2');
    expect(dogHeight(shiba)).toBeCloseTo(dogHeight(MALTESE) * 1.4);
    expect(box(svg)[1]).toBeLessThan(box(dogSvg(MALTESE, STILL, 90, 300))[1]);
  });
});
