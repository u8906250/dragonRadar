import { describe, expect, it } from 'vitest';
import { employerName, jobRisks, normalizeJobs, normalizeSlot } from '../src/jobs';
import { moduleOf } from '../src/modules';

const POST = `🐶 【台北誠徵/狗狗陪伴員】
因僱主工作原因需要出國公差
誠徵小幫手照顧狗狗
工作時間｜上午 9:00－12:00 下午 15:00－18:00
日期：11/20-11/30
📍 工作地點｜ 台北市大安區忠孝東路三段268號
薪資待遇｜NT$300/時
如果你喜歡狗狗 歡迎填寫表單了解詳情！`;

describe('normalizeJobs', () => {
  it('turns the model output into job events', () => {
    const r = normalizeJobs(
      JSON.stringify({
        is_job: true,
        jobs: [
          {
            title: '大安區狗狗陪伴員',
            place_text: '台北市大安區忠孝東路三段268號',
            place_query: '台北市大安區忠孝東路三段268號',
            work_from: '2026-11-20',
            work_to: '2026-11-30',
            slots: ['9:00－12:00', '15:00-18:00', '下午'],
            pay: 'NT$300/時',
            employer: null,
            contact: 'Form',
            requirements: '陪狗狗散步、玩耍',
            confidence: 0.9,
          },
        ],
      }),
    );
    expect(r?.is_event).toBe(true);
    expect(r?.events[0]).toMatchObject({ kind: 'job', title: '大安區狗狗陪伴員', item: 'NT$300/時', spot: false });
    expect(r?.events[0].job).toEqual({ role: 'hire', work_from: '2026-11-20', work_to: '2026-11-30', slots: ['09:00-12:00', '15:00-18:00'], pay: 'NT$300/時', employer: null, contact: 'form', requirements: '陪狗狗散步、玩耍' });
  });
  it('drops jobs when it is not a job post', () => {
    expect(normalizeJobs('{"is_job":false,"jobs":[{"title":"x"}]}')).toEqual({ is_event: false, events: [] });
  });
});

describe('normalizeSlot', () => {
  it('pads hours and unifies dashes', () => {
    expect(normalizeSlot('9:00～12:00')).toBe('09:00-12:00');
    expect(normalizeSlot('15：00 到 18：00')).toBe('15:00-18:00');
    expect(normalizeSlot('晚上')).toBeNull();
  });
});

describe('jobRisks', () => {
  const job = { role: 'hire' as const, work_from: null, work_to: null, slots: [], pay: null, employer: null, contact: 'form', requirements: null };
  it('flags a form-only post with no employer or phone', () => {
    expect(jobRisks(job, POST)).toEqual(['no_employer', 'form_only']);
  });
  it('does not flag a named shop with a phone number', () => {
    expect(jobRisks({ ...job, employer: '毛孩旅館', contact: 'phone' }, '請來電 02-2345-6789')).toEqual([]);
  });
  it('flags money requests and LINE-only contact', () => {
    expect(jobRisks({ ...job, contact: 'line' }, '加LINE了解，需先付保證金 500 元')).toEqual(['no_employer', 'line_only', 'money']);
  });
});

describe('moduleOf', () => {
  it('falls back to the 洋流 module', () => {
    expect(moduleOf('dog')).toBe('dog');
    expect(moduleOf('cat')).toBe('current');
    expect(moduleOf(undefined)).toBe('current');
  });
});

describe('employerName', () => {
  it('treats nameless words as no employer', () => {
    expect(employerName('僱主')).toBeNull();
    expect(employerName(' 飼主 ')).toBeNull();
    expect(employerName('毛孩旅館')).toBe('毛孩旅館');
  });
});

import { detectEnded } from '../src/events';

describe('detectEnded for jobs', () => {
  it('sees a filled job but not "until full"', () => {
    expect(detectEnded('更新：已徵到，謝謝大家')).toBe(true);
    expect(detectEnded('狗狗陪伴員 名額有限 額滿為止')).toBe(false);
  });
});

describe('offers to look after dogs', () => {
  it('reads an offer and only flags money requests', () => {
    const r = normalizeJobs({ is_job: true, jobs: [{ role: 'offer', title: '台中市區免費寄宿照顧', place_text: '台中市區', place_query: '台中市', work_from: null, work_to: null, slots: [], pay: '免費', employer: null, contact: 'dm', requirements: '飼主自備飼料、用品', confidence: 0.9 }] });
    const job = r?.events[0].job;
    expect(job?.role).toBe('offer');
    expect(job && jobRisks(job, '可以免費幫忙照顧，私訊我')).toEqual([]);
    expect(job && jobRisks(job, '照顧前要先匯保證金')).toEqual(['money']);
  });
});

import { WORK_SPEC } from '../src/jobs';
import { moduleSpec } from '../src/events';
import { reportModules } from '../src/reports';

describe('找工作 (work module)', () => {
  it('is its own module with its own prompt: short-term and part-time jobs, not full-time', () => {
    expect(moduleOf('work')).toBe('work');
    expect(moduleSpec('work')).toBe(WORK_SPEC);
    expect(WORK_SPEC.system).toContain('找工作雷達');
    expect(WORK_SPEC.system).toMatch(/正職.*is_job 為 false/);
    expect(reportModules('current,work')).toEqual(['current', 'work']);
  });
  it('reads a campaign office hiring part-timers to hand out flyers (no pay, area only, DM)', () => {
    const r = WORK_SPEC.normalize({
      is_job: true,
      jobs: [{ role: 'hire', title: '大安區選舉工讀生', place_text: '依當日行程而有所不同（主要在大安區）', place_query: '台北市 大安區', work_from: null, work_to: null, slots: ['09:00-19:00'], pay: null, employer: '大安文山議員競選總部', contact: 'dm', requirements: '發文宣，時段可彈性排班', confidence: 0.9 }],
    });
    expect(r?.is_event).toBe(true);
    expect(r?.events[0]).toMatchObject({ kind: 'job', title: '大安區選舉工讀生', item: null, place_query: '台北市 大安區' });
    expect(r?.events[0].job).toMatchObject({ role: 'hire', slots: ['09:00-19:00'], pay: null, employer: '大安文山議員競選總部', contact: 'dm' });
    // 有寫單位、私訊應徵：不標可疑
    expect(jobRisks(r!.events[0].job!, '有興趣歡迎直接私訊我')).toEqual([]);
  });
  it('reads someone looking for a part-time job, and names untitled ones for this module', () => {
    const r = WORK_SPEC.normalize({ is_job: true, jobs: [{ role: 'offer', title: '', place_text: '大安區', place_query: '台北市 大安區', work_from: null, work_to: null, slots: [], pay: null, employer: null, contact: 'dm', requirements: '週末打工', confidence: 0.8 }] });
    expect(r?.events[0]).toMatchObject({ title: '找工作' });
    expect(r?.events[0].job?.role).toBe('offer');
    expect(WORK_SPEC.normalize({ is_job: true, jobs: [{ role: 'hire', place_text: 'x', confidence: 0.8 }] })?.events[0].title).toBe('工讀');
    // 狗狗陪伴照舊
    expect(normalizeJobs({ is_job: true, jobs: [{ role: 'offer', place_text: 'x', confidence: 0.8 }] })?.events[0].title).toBe('可幫忙照顧狗狗');
  });
});
