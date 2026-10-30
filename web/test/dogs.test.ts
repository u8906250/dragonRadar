import { describe, expect, it, vi } from 'vitest';
import { dogSvg, MALTESE, STILL, dogHeight, type DogLook } from '../src/dog';
import { Dog, dogById, dogPose, lookAtViewer, NATURE, speedOf, type DogSeg, type DogYard } from '../src/dogs';

/** 兩塊 40 公尺見方的草皮，中間隔 20 公尺的地面（緯經度當公尺用，1 度 = 1 公尺） */
const lawn = (ring: number, rand: () => number): [number, number] => [rand() * 40, ring * 60 + rand() * 40];
const YARD: DogYard = {
  anywhere: (rand) => ({ ring: 0, at: lawn(0, rand) }),
  within: (ring, rand) => lawn(ring, rand),
  // 換草皮照「步道」走：先走到兩塊中間的 (20, 50)，再走進另一塊
  elsewhere: (ring, _at, rand) => ({ ring: 1 - ring, path: [[20, 50], lawn(1 - ring, rand)] }),
  // 兩塊草皮中間的地面上有個小水池：岸在 (45, 50)
  water: () => ({ path: [[45, 50]], face: [45.4, 50] }),
  metres: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
};
const onLawn = (ring: number, [y, x]: [number, number]): boolean => y >= 0 && y <= 40 && x >= ring * 60 && x <= ring * 60 + 40;
/** 白天（中午 12 點）：不受跑測試是幾點影響 */
const noon = (): number => 12;
const seeded = (seed: number) => (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

describe('會動的狗（dogs.ts）', () => {
  it('walks slowly, runs, stops, sniffs and sits, one piece after another', () => {
    const rand = seeded(11);
    const dog = new Dog({ id: 'test-a', name: '測試', look: MALTESE, yard: YARD, hour: noon });
    expect(dogById('test-a')).toBe(dog);
    dog.place(rand, 0);
    // 三小時，每半秒看一次：一段接一段（沒有跳），停著的不動，走、跑照速度，每一段一開始面向上一段的方向
    const segs = new Map<number, NonNullable<Dog['seg']>>();
    for (let t = 0; t <= 3 * 3_600_000; t += 500) {
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
        expect(YARD.metres(s.from, s.to) / (s.ms / 1000)).toBeCloseTo(speedOf(s), 6);
        expect(s.dir).toEqual([s.to[0] - s.from[0], s.to[1] - s.from[1]]);
      } else {
        expect(s.to).toEqual(s.from);
        // 停著的面向不變（喝水的轉向水）
        if (s.do !== 'drink') expect(s.dir).toEqual(s.dir0);
      }
    }
    // （白天偶爾打個盹）
    expect(new Set(list.map((s) => s.do))).toEqual(new Set(['stand', 'idle', 'sniff', 'sit', 'lie', 'sleep', 'stretch', 'drink', 'walk', 'run']));
    for (const s of list.filter((x) => x.do === 'sleep')) expect(s.ms).toBeLessThanOrEqual(600_000);
    // 跑完不一定休息：趴下來、停下來發呆，或改成走路（不再跑）
    const afterRun = list.filter((s, i) => i > 0 && list[i - 1].do === 'run' && !list[i - 1].goal && !list[i - 1].via?.length);
    expect(afterRun.length).toBeGreaterThan(10);
    for (const how of ['lie', 'idle', 'walk'] as const) expect(afterRun.some((s) => s.do === how)).toBe(true);
    expect(afterRun.filter((s) => s.do === 'lie' || s.do === 'idle' || s.do === 'walk').length).toBeGreaterThan(afterRun.length * 0.8);
    expect(afterRun.some((s) => s.do === 'run')).toBe(false);
    // 走路慢慢走，大多是走一走、停下來聞一聞（也會邊走邊聞），在草皮裡偶爾才跑
    expect(NATURE.speed.walk).toBeLessThanOrEqual(0.3);
    const count = (f: (s: DogSeg) => boolean): number => list.filter(f).length;
    expect(count((s) => s.do === 'sniff') + count((s) => !!s.nose)).toBeGreaterThan(count((s) => s.do === 'stand') + count((s) => s.do === 'sit'));
    expect(count((s) => s.do === 'walk' && !s.cross && !s.goal)).toBeGreaterThan(count((s) => s.do === 'run' && !s.cross && !s.goal) * 5);
    // 跑步不多（不到移動的一成）；趴著休息久一點（15～35 秒）
    // 一趟算一次（照步道走的轉折點不重複算）
    const moves = list.filter((s) => (s.do === 'walk' || s.do === 'run') && !s.via?.length);
    expect(moves.filter((s) => s.do === 'run').length).toBeLessThan(moves.length * 0.12);
    for (const s of list.slice(1)) if (s.do === 'lie') expect(s.ms).toBeGreaterThanOrEqual(15_000);
    // 在草皮裡跑一下就好（8 公尺內，約 3 秒）
    for (const s of list) if (s.do === 'run' && !s.cross && !s.goal) expect(YARD.metres(s.from, s.to)).toBeLessThanOrEqual(8 + 1e-9);
    expect(count((s) => !!s.nose)).toBeGreaterThan(0);
    // 待在一塊草皮裡；換草皮時經過地面過去
    // 喝水：先走或跑到岸上，面向水喝，喝完走回原來的地方（其他時候都在草皮上）
    const drinks = list.map((s, i) => [s, i] as const).filter(([s]) => s.do === 'drink');
    expect(drinks.length).toBeGreaterThan(0);
    for (const [s, i] of drinks) {
      const [go, back] = [list[i - 1], list[i + 1]];
      expect(go.goal).toBe('drink');
      expect(s.from).toEqual([45, 50]);
      expect(s.dir[0]).toBeCloseTo(0.4);
      if (back) expect(back.to).toEqual(go.from);
    }
    // 停下來、走完一整段都在草皮上（喝水的岸邊、照步道走到一半的轉折點除外）
    const shore = new Set(drinks.flatMap(([, i]) => [i - 1, i]));
    list.forEach((s, i) => {
      if (!shore.has(i) && !s.via?.length) expect(onLawn(s.ring, s.to)).toBe(true);
    });
    // 照步道換草皮：先走到中間的轉折點，再接著走進去（同一種走法）
    const turns = list.map((s, i) => [s, i] as const).filter(([s]) => s.cross && s.via?.length);
    expect(turns.length).toBeGreaterThan(0);
    for (const [s, i] of turns) {
      expect(s.to).toEqual([20, 50]);
      expect(list[i + 1]?.do ?? s.do).toBe(s.do);
      if (list[i + 1]) expect(list[i + 1].from).toEqual([20, 50]);
    }
    const cross = list.filter((s) => s.cross);
    expect(cross.length).toBeGreaterThan(2);
    for (const s of cross) if (s.via?.length) expect(onLawn(s.ring, s.from)).toBe(false);
    // 換草皮時用走的、用跑的都有（照個性 crossRun，小法一半一半）
    expect(cross.some((s) => s.do === 'run')).toBe(true);
    expect(cross.some((s) => s.do === 'walk')).toBe(true);
    // 在草皮裡走、跑（喝完水從岸邊走回來的除外）
    list.forEach((s, i) => {
      if (!s.cross && (s.do === 'walk' || s.do === 'run') && list[i - 1]?.do !== 'drink') expect(onLawn(s.ring, s.from)).toBe(true);
    });
  });

  it('follows its own nature (another dog can love running)', () => {
    const rand = seeded(3);
    const runner = new Dog({ id: 'test-c', name: '愛跑的', look: MALTESE, yard: YARD, nature: { ...NATURE, run: 0.6, stays: { sniff: 1 }, afterRun: { lie: 1, idle: 0, walk: 0 } }, hour: noon });
    runner.place(rand, 0);
    const segs = new Map<number, NonNullable<Dog['seg']>>();
    for (let t = 0; t <= 3_600_000; t += 500) segs.set(runner.now(t, rand).seg.start, runner.now(t, rand).seg);
    const list = [...segs.values()];
    const runs = list.filter((s) => s.do === 'run' && !s.cross && !s.goal).length;
    const walks = list.filter((s) => s.do === 'walk' && !s.cross && !s.goal).length;
    expect(runs).toBeGreaterThan(walks * 0.8);
    // 停下來只會聞（跑完趴下、趴完伸懶腰照樣有；第一段是剛放下來站著）
    expect(list.slice(1).some((s) => s.do === 'stand' || s.do === 'sit' || s.do === 'idle')).toBe(false);
  });

  it('curls up to sleep, much more at night (until 9 in the morning), and wakes up when tapped', () => {
    // 從晚上 10 點開始（performance.now() 的 0 是 22:00）
    const at22 = (t: number): number => (22 + t / 3_600_000) % 24;
    const rand = seeded(21);
    const dog = new Dog({ id: 'test-sleep', name: '測試', look: MALTESE, yard: YARD, hour: at22 });
    dog.place(rand, 0);
    let slept: DogSeg | null = null;
    for (let t = 0; t <= 3_600_000 && !slept; t += 500) {
      const d = dog.now(t, rand);
      if (d.seg.do === 'sleep') slept = d.seg;
    }
    // 晚上很快就睡了，一睡就睡到早上 9 點
    expect(slept).not.toBeNull();
    expect(slept!.start).toBeLessThan(1_800_000);
    expect(at22(slept!.start + slept!.ms)).toBeCloseTo(9, 3);
    // 睡覺的樣子：趴下、捲起來、閉眼睛
    const p = dogPose(slept!, 60_000);
    expect(p.lie).toBe(1);
    expect(p.curl).toBe(1);
    expect(p.blink).toBe(1);
    // 點了醒過來：慢慢站起來，接著伸懶腰（不會轉頭看、不會坐下）
    const t1 = slept!.start + 60_000;
    dog.pet(t1, () => 0);
    expect(dog.glance).toBeNull();
    expect(dog.seg!.do).toBe('sleep');
    expect(dog.seg!.start + dog.seg!.ms - t1).toBeLessThanOrEqual(1600);
    expect(dog.now(t1 + 1700, rand).seg.do).toBe('stretch');
    // 白天：大多不睡，睡了也只是打個盹
    const day = new Dog({ id: 'test-nap', name: '測試', look: MALTESE, yard: YARD, hour: noon });
    day.place(rand, 0);
    let stays = 0;
    let naps = 0;
    for (let t = 0, last = -1; t <= 3_600_000; t += 500) {
      const s = day.now(t, rand).seg;
      if (s.start === last) continue;
      last = s.start;
      if (s.from === s.to) stays++;
      if (s.do === 'sleep') {
        naps++;
        expect(s.ms).toBeLessThanOrEqual(600_000);
      }
    }
    expect(naps).toBeLessThan(stays * 0.1);
  });

  it('stays where it was after reloading the page', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    try {
      const rand = seeded(9);
      const a = new Dog({ id: 'test-reload', name: '測試', look: MALTESE, yard: YARD, hour: noon });
      a.place(rand, 1000);
      const before = a.now(20_000, rand);
      expect(store.has('dr.dog.test-reload')).toBe(true);
      // 重新整理：同一隻狗（同一個 id）接著同一段，在同一個地方
      const b = new Dog({ id: 'test-reload', name: '測試', look: MALTESE, yard: YARD, hour: noon });
      expect(b.seg?.start).toBeCloseTo(before.seg.start, 3);
      expect(b.now(20_000, rand).at).toEqual(before.at);
      // 離開很久了：停在上次那一段的終點
      const c = new Dog({ id: 'test-reload', name: '測試', look: MALTESE, yard: YARD, hour: noon });
      const later = c.now(before.seg.start + before.seg.ms + 600_000, rand);
      expect(later.seg.from).toEqual(before.seg.to);
      // 存的東西壞掉：重新放
      store.set('dr.dog.test-reload', '{"do":1}');
      expect(new Dog({ id: 'test-reload', name: '測試', look: MALTESE, yard: YARD, hour: noon }).seg).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('sometimes just turns its head to look at you when tapped, and carries on', () => {
    const rand = seeded(4);
    const dog = new Dog({ id: 'test-glance', name: '測試', look: MALTESE, yard: YARD, hour: noon });
    dog.place(rand, 0);
    const before = dog.now(10_000, rand);
    dog.pet(10_000, () => 0);
    // 原本在做的事照舊（沒有坐下），頭轉過來看你 2.6 秒，頭尾慢慢轉
    expect(dog.now(10_100, rand).seg).toBe(before.seg);
    expect(dog.glancing(10_000)).toBe(0);
    expect(dog.glancing(11_000)).toBe(1);
    expect(dog.glancing(12_600)).toBe(0);
    expect(dog.glance).toBeNull();
    // 頭往你那邊轉：面向右邊往右轉、面向左邊往左轉、朝你不用轉，背對你最多轉 80 度（從肩膀回頭看）
    expect(lookAtViewer(90)).toBe(-80);
    expect(lookAtViewer(270)).toBe(80);
    expect(lookAtViewer(180)).toBe(0);
    expect(lookAtViewer(135)).toBe(-45);
    expect(Math.abs(lookAtViewer(0))).toBe(80);
    // 照個性：大概六成只轉頭看、四成轉過來坐下
    let looks = 0;
    for (let i = 0; i < 200; i++) {
      const d = new Dog({ id: `test-glance-${i}`, name: '測試', look: MALTESE, yard: YARD, hour: noon });
      d.place(rand, 0);
      d.pet(1000, rand);
      if (d.glance) looks++;
    }
    expect(looks).toBeGreaterThan(95);
    expect(looks).toBeLessThan(145);
  });

  it('turns to face you (south) and sits when tapped, and sits longer when tapped again', () => {
    const rand = seeded(5);
    const dog = new Dog({ id: 'test-b', name: '測試', look: MALTESE, yard: YARD, hour: noon });
    dog.place(rand, 0);
    const before = dog.now(20_000, rand);
    // （不要只轉頭看）
    dog.pet(20_000, () => 0.99);
    const d = dog.now(20_100, rand);
    expect(d.seg.do).toBe('sit');
    expect(d.seg.pet).toBe(true);
    expect(d.at).toEqual(before.at);
    expect(d.seg.dir[0]).toBeLessThan(0);
    expect(d.seg.dir[1]).toBe(0);
    // 先轉身再坐下，坐好時搖尾巴（不吐舌頭、嘴巴不畫出來），最後站起來
    expect(dogPose(d.seg, 100).sit).toBe(0);
    expect(dogPose(d.seg, 2000).sit).toBe(1);
    expect(dogPose(d.seg, 2000).tongue).toBe(false);
    expect(dogPose(d.seg, d.seg.ms).sit).toBe(0);
    const end = d.seg.start + d.seg.ms;
    dog.pet(23_000);
    expect(dog.now(23_100, rand).seg.start).toBe(20_000);
    expect(dog.seg!.start + dog.seg!.ms).toBeGreaterThan(end);
  });
});

describe('姿勢（dogPose）', () => {
  const seg = (d: DogSeg['do'], extra: Partial<DogSeg> = {}): DogSeg => ({ do: d, from: [0, 0], to: [1, 0], start: 0, ms: 8000, dir0: [1, 0], dir: [1, 0], ring: 0, ...extra });

  it('walks one leg after another, and runs like a dog (front legs together, hind legs together)', () => {
    // 走路：四隻腳輪流（各差四分之一步），往前擺時抬起來
    for (let e = 0; e < 750; e += 50) {
      const legs = dogPose(seg('walk'), e).legs;
      expect(new Set(legs.map(([d]) => d.toFixed(3))).size).toBeGreaterThanOrEqual(3);
    }
    // 跑步：前腳差不多一起、後腳差不多一起，前後相反（伸長、收起來），身體離地、耳朵往後飛、吐舌頭
    for (let e = 0; e < 260; e += 20) {
      const p = dogPose(seg('run'), e);
      const [fl, fr, hl, hr] = p.legs.map(([d]) => d);
      expect(Math.abs(fl - fr)).toBeLessThan(20);
      expect(Math.abs(hl - hr)).toBeLessThan(20);
      if (Math.abs(fl) > 30) expect(Math.sign(hl)).toBe(-Math.sign(fl));
      expect(p.bob).toBeGreaterThan(0);
      expect(p.ear).toBeGreaterThan(20);
      expect(p.tongue).toBe(true);
    }
  });

  it('lies down to rest: body on the ground, front legs forward, sometimes chin down with eyes closed', () => {
    const k = 400;
    const y = (svg: string, part: string): number => Number(new RegExp(`data-part="${part}"><ellipse cx="[-\\d.]+" cy="([-\\d.]+)"`).exec(svg)![1]);
    const x = (svg: string, part: string): number => Number(new RegExp(`data-part="${part}"><ellipse cx="([-\\d.]+)"`).exec(svg)![1]);
    const lying = dogPose(seg('lie', { ms: 9000 }), 3000);
    expect(lying.lie).toBe(1);
    const [stand, lie] = [dogSvg(MALTESE, STILL, 90, k), dogSvg(MALTESE, lying, 90, k)];
    // 身體往下 10 公分以上（貼地），前腳掌伸到胸口前面
    expect(y(lie, 'body') - y(stand, 'body')).toBeGreaterThan(0.1 * k * 0.9);
    expect(x(lie, 'legflpaw')).toBeGreaterThan(x(lie, 'chest') + 0.05 * k);
    expect(lie).toContain('data-part="leghlthigh"');
    // 頭抬著、張著眼睛（偶爾眨眼）；休息的下巴靠下去、閉眼睛
    expect(lying.blink).toBe(0);
    const rest = dogPose(seg('lie', { ms: 9000, rest: true }), 4000);
    expect(rest.blink).toBe(1);
    expect(rest.nod).toBeGreaterThan(15);
    expect(dogSvg(MALTESE, rest, 180, k)).not.toContain('data-part="pupil1"');
    // 一開始、最後是站著
    expect(dogPose(seg('lie', { ms: 9000 }), 0).lie).toBe(0);
  });

  it('shows the lip line only when standing or walking', () => {
    const k = 400;
    const face = (d: DogSeg['do'], e = 2000): string => dogSvg(MALTESE, dogPose(seg(d, { ms: 9000 }), e), 180, k);
    for (const d of ['stand', 'idle', 'walk'] as const) {
      expect(dogPose(seg(d), 2000).lips).toBe(true);
      for (const part of ['philtrum', 'lip1', 'lip-1']) expect(face(d)).toContain(`data-part="${part}"`);
    }
    for (const d of ['sit', 'lie', 'run', 'sniff', 'drink', 'stretch'] as const) {
      expect(dogPose(seg(d), 2000).lips).toBe(false);
      expect(face(d)).not.toContain('data-part="lip1"');
    }
    // 從背後看不到
    expect(dogSvg(MALTESE, dogPose(seg('stand'), 2000), 0, k)).not.toContain('data-part="lip1"');
  });

  it('zones out: stands still staring to one side, tail still, blinking slowly', () => {
    const s = seg('idle', { ms: 8000 });
    const ps = Array.from({ length: 40 }, (_, i) => dogPose(s, 1500 + i * 100));
    for (const p of ps) {
      expect(Math.abs(p.look)).toBeCloseTo(22);
      expect(p.wag).toBe(0);
      expect(p.legs.every(([d]) => d === 0)).toBe(true);
    }
    // 慢慢眨眼：閉到一半的時候也有
    expect(ps.some((p) => p.blink > 0.3 && p.blink < 0.9)).toBe(true);
  });

  it('blinks now and then', () => {
    const s = seg('stand', { ms: 60_000 });
    const blinks = Array.from({ length: 600 }, (_, i) => dogPose(s, i * 50).blink);
    expect(blinks.filter((b) => b === 1).length).toBeGreaterThan(5);
    expect(blinks.filter((b) => b === 1).length).toBeLessThan(60);
  });

  it('laps water with its head down at the lake', () => {
    const s = seg('drink', { ms: 5500 });
    const ps = Array.from({ length: 20 }, (_, i) => dogPose(s, 1500 + i * 60));
    for (const p of ps) {
      expect(p.nod).toBeGreaterThan(50);
      expect(p.lean).toBeGreaterThan(10);
    }
    // 舌頭一伸一縮
    expect(new Set(ps.map((p) => p.tongue))).toEqual(new Set([true, false]));
  });

  it('stretches like a downward dog: front legs forward on the ground, chest down, rump up', () => {
    const s = seg('stretch', { ms: 3400 });
    const p = dogPose(s, 1700);
    expect(p.lean).toBeGreaterThan(20);
    for (const [deg, lift] of p.legs.slice(0, 2)) {
      expect(deg).toBeGreaterThan(60);
      expect(lift).toBeLessThan(0);
    }
    const k = 400;
    /** 這個部位的橢圓中心（畫面像素） */
    const at = (svg: string, part: string): [number, number] => {
      const m = new RegExp(`data-part="${part}"><ellipse cx="([-\\d.]+)" cy="([-\\d.]+)"`).exec(svg)!;
      return [Number(m[1]), Number(m[2])];
    };
    const side = dogSvg(MALTESE, p, 90, k);
    // 前腳掌貼在地上（腳掌中心離地 2 公分，另一邊的腳在畫面上高一點）、在胸口前面；胸口比屁股低
    expect(at(side, 'legflpaw')[0]).toBeGreaterThan(at(side, 'chest')[0] + 0.05 * k);
    expect(at(side, 'legflpaw')[1]).toBeGreaterThan(-0.05 * k);
    expect(at(side, 'legfrpaw')[1]).toBeGreaterThan(-0.03 * k);
    expect(at(side, 'chest')[1]).toBeGreaterThan(at(side, 'rump')[1] + 0.03 * k);
    // 一開始、最後是站著
    expect(dogPose(s, 0).lean).toBe(0);
    expect(dogPose(s, 3400).lean).toBe(0);
  });

  it('puts its nose down to the ground when sniffing', () => {
    const p = dogPose(seg('sniff'), 2000);
    expect(p.nod).toBeGreaterThan(45);
    expect(p.lean).toBeGreaterThan(8);
    const k = 400;
    const noseY = (svg: string): number => Number(/data-part="nose"><ellipse cx="[-\d.]+" cy="([-\d.]+)"/.exec(svg)![1]);
    // 鼻子離地不到 7 公分（畫面往下是正的，地是 0）
    expect(noseY(dogSvg(MALTESE, p, 90, k))).toBeGreaterThan(-0.07 * k * Math.cos((22 * Math.PI) / 180));
    // 邊走邊聞：頭也低下去
    expect(dogPose(seg('walk', { nose: true }), 2000).nod).toBeGreaterThan(30);
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

  it('grows dense fur like grass, at any size', () => {
    const hairs = (k: number): number => (dogSvg(MALTESE, STILL, 90, k).match(/Q/g) ?? []).length;
    // 拉近：整隻最多約 3600 根（臉附近密一點，背面的不畫，畫出來兩千多根）
    expect(hairs(400)).toBeGreaterThan(1500);
    expect(hairs(400)).toBeLessThan(2600);
    // 畫面上小的時候（整隻約 11 像素高）也是密密的：約每 1.6 像素一根
    const small = 30;
    expect(hairs(small)).toBeGreaterThan(120);
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
