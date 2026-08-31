/**
 * LINE の「送れる通数」を数えて、使いすぎる前に知らせる。
 *
 * ★なぜ要るか（2026-08-31 運用側の判断）:
 *   無料プラン（コミュニケーションプラン）は **1か月に200通**まで。
 *   超えると送れなくなるか、追加料金がかかる。
 *   気づかないまま上限に当たると、**プレビューも完成の知らせも届かなくなる**。
 *
 * ★数えるのは「こちらから送るもの（プッシュ）」だけ。
 *   利用者の発言への返信は無料で、通数に含まれない。
 *
 * ★数え方はおおよそで構わない。
 *   目的は「請求を1円単位で当てること」ではなく「使いすぎに気づかせること」。
 *   多少ずれても、警告が出れば役目を果たす。
 */
import { log } from '../../lib/mask';

/** 無料プランで送れる通数（コミュニケーションプラン） */
export const FREE_LIMIT = 200;

/** ここを超えたら知らせる */
export const THRESHOLDS = [100, 150, 190] as const;

/** 月ごとに数える。JST で締める（利用者の感覚に合わせる） */
export function monthKey(now = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}`;
}

const countKey = (month: string) => `linecount:${month}`;
const warnedKey = (month: string) => `linewarn:${month}`;

/**
 * 送った数を足して、越えた区切りがあれば返す。
 *
 * @returns 越えた区切り（100 / 150 / 190）。無ければ null
 */
export async function recordPush(
  kv: KVNamespace, sent = 1, now = new Date(),
): Promise<{ total: number; crossed: number | null }> {
  const month = monthKey(now);
  let before = 0;
  try {
    before = Number((await kv.get(countKey(month))) ?? 0) || 0;
  } catch (e) {
    // 数えられなくても送信は止めない
    log.warn('通数を読めませんでした', String(e));
    return { total: 0, crossed: null };
  }

  const total = before + sent;
  try {
    // 月をまたいだら自然に消えるよう、45日で期限切れにする
    await kv.put(countKey(month), String(total), { expirationTtl: 45 * 24 * 60 * 60 });
  } catch (e) {
    log.warn('通数を保存できませんでした', String(e));
    return { total, crossed: null };
  }

  // ★またいだ区切りのうち、いちばん大きいものだけを知らせる。
  //   1回の送信で複数またいでも、警告は1通で足りる
  const crossed = [...THRESHOLDS].reverse().find((t) => before < t && total >= t) ?? null;
  if (crossed === null) return { total, crossed: null };

  // 同じ区切りで何度も知らせない
  try {
    const warned = ((await kv.get(warnedKey(month))) ?? '').split(',').filter(Boolean);
    if (warned.includes(String(crossed))) return { total, crossed: null };
    await kv.put(warnedKey(month), [...warned, String(crossed)].join(','),
      { expirationTtl: 45 * 24 * 60 * 60 });
  } catch (e) {
    log.warn('警告の記録に失敗しました', String(e));
  }

  return { total, crossed };
}

/** 知らせる文面。★何をすればいいかまで書く */
export function buildQuotaWarning(total: number, crossed: number): string {
  const rest = Math.max(FREE_LIMIT - total, 0);
  const head = crossed >= 190
    ? '⚠ LINE の無料通数が、まもなく上限です。'
    : 'LINE の無料通数のお知らせです。';

  return `${head}\n\n`
    + `今月の送信：${total} 通 / ${FREE_LIMIT} 通\n`
    + `残り：約 ${rest} 通\n\n`
    + '※ここで数えているのは、システムから届く通知だけです。\n'
    + 'あなたの発言への返信は通数に含まれません。\n\n'
    + (crossed >= 190
      ? '上限に達すると、記事のプレビューや完成のお知らせが届かなくなります。\n'
        + '・記事の修正回数を減らす\n'
        + '・LINE公式アカウントの月額プランを上げる\n'
        + 'のどちらかをご検討ください。'
      : '上限に達すると通知が届かなくなります。ペースの目安にしてください。');
}
