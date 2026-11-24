import { describe, expect, it } from 'vitest';
import { modelLabel } from '../src/extract';
import { estimateSeconds, judgeOf, JUDGE_DEFAULT_SEC } from '../src/reports';

describe('modelLabel', () => {
  it('writes model names for people', () => {
    expect(modelLabel('claude-haiku-4-5')).toBe('Claude Haiku 4.5');
    expect(modelLabel('claude-sonnet-4-5-20250929')).toBe('Claude Sonnet 4.5');
    expect(modelLabel('claude-opus-5-5')).toBe('Claude Opus 5.5');
    expect(modelLabel('claude-fable-5')).toBe('Claude Fable 5');
    expect(modelLabel('@cf/openai/gpt-oss-120b')).toBe('gpt-oss-120b');
  });
});

describe('estimateSeconds', () => {
  it('needs a few samples, then rounds the median up', () => {
    expect(estimateSeconds([3000, 4000])).toBeNull();
    expect(estimateSeconds([6100, 9000, 7200, 30000, 6500])).toBe(8);
    expect(estimateSeconds([6000, 7000, 8000, 9000, 50000, 5000])).toBe(8);
    expect(estimateSeconds([100, 200, 300, 400, 500])).toBe(1);
    expect(JUDGE_DEFAULT_SEC).toBe(10);
  });
});

describe('judgeOf', () => {
  it('reads the model from the stored extraction and the time it took', () => {
    expect(judgeOf({ extraction: JSON.stringify({ model: 'claude-haiku-4-5', fidelity: 1, response: '{}' }), judge_ms: 7400 })).toEqual({ model: 'Claude Haiku 4.5', seconds: 7 });
    expect(judgeOf({ extraction: JSON.stringify({ model: '@cf/openai/gpt-oss-120b' }), judge_ms: null })).toEqual({ model: 'gpt-oss-120b', seconds: null });
    expect(judgeOf({ extraction: JSON.stringify({ model: 'claude-haiku-4-5' }), judge_ms: 200 })?.seconds).toBe(1);
  });
  it('has nothing for posts without an AI judgement', () => {
    expect(judgeOf({ extraction: null, judge_ms: 5000 })).toBeNull();
    expect(judgeOf({ extraction: 'not json', judge_ms: 5000 })).toBeNull();
    expect(judgeOf({ extraction: 'null', judge_ms: null })).toBeNull();
  });
});
