import { describe, expect, it } from 'vitest';
import { missingActivityParts, normalizeActivities } from '../src/extract';
import { notListedWhy, reportModules } from '../src/reports';

describe('normalizeActivities', () => {
  it('keeps every event as a single activity and blanks a missing title', () => {
    const ex = normalizeActivities(
      JSON.stringify({
        is_event: true,
        events: [
          { title: '景華公園表演同樂會', start_at: '2026-10-26T14:00:00+08:00', end_at: '2026-10-26T17:00:00+08:00', place_text: '景華公園', place_query: '台北市 景華公園', confidence: 0.9 },
          { title: null, start_at: '2026-10-27T14:00:00+08:00', end_at: null, place_text: null, place_query: null, confidence: 0.6, country: 'TW' },
        ],
      }),
    );
    expect(ex?.is_event).toBe(true);
    expect(ex?.events).toHaveLength(2);
    expect(ex?.events.every((e) => e.kind === 'activity' && !e.spot && e.item === null && e.until === null)).toBe(true);
    expect(ex?.events[1].title).toBe('');
    expect(ex?.events[1].country).toBeNull();
  });
  it('drops events when the post is not an event', () => {
    expect(normalizeActivities({ is_event: false, events: [{ title: 'x' }] })?.events).toEqual([]);
  });
});

describe('missingActivityParts', () => {
  const full = { title: '保安宮市政開講', place_text: '保安宮', place_query: '台北市 大龍峒保安宮', start_at: '2026-10-26T19:00:00+08:00', end_at: '2026-10-26T21:00:00+08:00' };
  it('accepts content, place and start', () => {
    expect(missingActivityParts(full)).toEqual([]);
  });
  it('does not need an end time (shown as 發完為止)', () => {
    const { end_at: _end, ...noEnd } = full;
    expect(missingActivityParts(noEnd)).toEqual([]);
  });
  it('lists what is missing in order', () => {
    expect(missingActivityParts({ title: ' ', place_text: null, place_query: null, start_at: 'soon' })).toEqual(['content', 'place', 'start']);
  });
  it('takes the place from either field', () => {
    expect(missingActivityParts({ ...full, place_query: null })).toEqual([]);
    expect(missingActivityParts({ ...full, place_text: null })).toEqual([]);
  });
});

describe('notListedWhy incomplete', () => {
  it('merges what each activity lacks', () => {
    expect(
      notListedWhy([
        { group: 0, plan: null, reason: 'incomplete:start' },
        { group: 1, plan: null, reason: 'incomplete:place,start' },
      ]),
    ).toEqual({ reason: 'incomplete', missing: ['place', 'start'] });
  });
  it('stays generic when mixed with other reasons', () => {
    expect(notListedWhy([{ group: 0, plan: null, reason: 'incomplete:start' }, { group: 1, plan: null, reason: 'already_over' }])).toBeUndefined();
  });
});

describe('reportModules', () => {
  it('opens every module by default or with "true"', () => {
    expect(reportModules(undefined)).toEqual(['current', 'dog', 'badminton', 'food']);
    expect(reportModules('true')).toEqual(['current', 'dog', 'badminton', 'food']);
  });
  it('locks everything with "false"', () => {
    expect(reportModules('false')).toEqual([]);
  });
  it('opens only the listed modules', () => {
    expect(reportModules('current')).toEqual(['current']);
    expect(reportModules(' current , food ,nope')).toEqual(['current', 'food']);
  });
});
