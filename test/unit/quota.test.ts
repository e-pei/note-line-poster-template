/**
 * LINE の通数を数えて、使いすぎる前に知らせる。
 *
 * ★無料プランは1か月200通。超えると通知が届かなくなり、
 *   「公開したのに知らせが来ない」が起きる。気づける形にしておく。
 */
import { describe, it, expect } from 'vitest';
import { recordPush, buildQuotaWarning, monthKey, FREE_LIMIT, THRESHOLDS } from '../../src/core/line/quota';

function fakeKv(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    store,
    get: async (k: string) => store[k] ?? null,
    put: async (k: string, v: string) => { store[k] = v; },
    delete: async (k: string) => { delete store[k]; },
  } as unknown as KVNamespace & { store: Record<string, string> };
}

const M = monthKey();

describe('通数を数える', () => {
  it('送るたびに増える', async () => {
    const kv = fakeKv();
    expect((await recordPush(kv)).total).toBe(1);
    expect((await recordPush(kv)).total).toBe(2);
  });

  it('区切りを越えていなければ知らせない', async () => {
    const kv = fakeKv({ [`linecount:${M}`]: '50' });
    expect((await recordPush(kv)).crossed).toBeNull();
  });

  it('★100 / 150 / 190 を越えたときだけ知らせる', async () => {
    for (const t of THRESHOLDS) {
      const kv = fakeKv({ [`linecount:${M}`]: String(t - 1) });
      expect((await recordPush(kv)).crossed, `${t} で知らせるはず`).toBe(t);
    }
  });

  it('★同じ区切りで二度は知らせない', async () => {
    const kv = fakeKv({ [`linecount:${M}`]: '99' });
    expect((await recordPush(kv)).crossed).toBe(100);
    // 記録を戻しても、警告済みなので知らせない
    kv.store[`linecount:${M}`] = '99';
    expect((await recordPush(kv)).crossed).toBeNull();
  });

  it('一気にまたいでも、警告は1回だけ（大きいほうを出す）', async () => {
    const kv = fakeKv({ [`linecount:${M}`]: '95' });
    expect((await recordPush(kv, 60)).crossed).toBe(150);
  });

  it('★数えられなくても送信は止めない', async () => {
    const broken = { get: async () => { throw new Error('down'); } } as unknown as KVNamespace;
    const r = await recordPush(broken);
    expect(r.crossed).toBeNull();   // 例外を投げない
  });

  it('月が変わると数え直す', () => {
    const jan = monthKey(new Date('2026-01-15T00:00:00Z'));
    const feb = monthKey(new Date('2026-02-15T00:00:00Z'));
    expect(jan).not.toBe(feb);
  });

  it('日本時間で締める（月末の夜に前月扱いにならない）', () => {
    // 1月31日 23:00 JST = 1月31日 14:00 UTC
    expect(monthKey(new Date('2026-01-31T14:00:00Z'))).toBe('2026-01');
    // 2月1日 0:00 JST = 1月31日 15:00 UTC
    expect(monthKey(new Date('2026-01-31T15:00:00Z'))).toBe('2026-02');
  });
});

describe('知らせる文面', () => {
  it('残りの通数と、何が起きるかを書く', () => {
    const msg = buildQuotaWarning(190, 190);
    expect(msg).toContain(`${FREE_LIMIT}`);
    expect(msg).toContain('残り');
    expect(msg).toContain('届かなくなります');
  });

  it('★返信は数に入らないことを明記する（誤解を招かない）', () => {
    expect(buildQuotaWarning(100, 100)).toContain('返信は通数に含まれません');
  });

  it('190 を越えたときは、対処まで書く', () => {
    const msg = buildQuotaWarning(192, 190);
    expect(msg).toContain('修正回数');
    expect(msg).toContain('月額プラン');
  });
});
