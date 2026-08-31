/**
 * LINE Messaging API クライアント。
 *
 * ★課金の要点:
 *   Reply（応答メッセージ）は無料 / Push は課金対象。
 *   replyToken の寿命は約1分なので、記事生成（1〜3分）の完了通知は Push を使う。
 *   1記事あたり Push 1〜2通に抑えれば、無料プラン（月200通）で月100本前後まで回る。
 */
import { log } from '../../lib/mask';
import { recordPush, buildQuotaWarning } from '../../core/line/quota';

const API = 'https://api.line.me/v2/bot';
const CONTENT_API = 'https://api-data.line.me/v2/bot';

export interface LineMessage {
  type: 'text' | 'flex';
  [k: string]: unknown;
}

export class LineClient {
  /**
   * @param kv 渡すと、送った通数を数えて上限が近いことを知らせる。
   *   ★数えるのはプッシュだけ（返信は無料で通数に含まれない）。
   *   渡さなくても送信は普通にできる（数えないだけ）。
   */
  constructor(
    private readonly accessToken: string,
    private readonly kv?: KVNamespace,
  ) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  private async call(path: string, body: unknown): Promise<void> {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      log.warn(`LINE API 失敗 ${path}`, { status: res.status, body: text.slice(0, 300) });
      // 通知の失敗で本処理を落とさない（記事は投稿済みかもしれない）
    }
  }

  /** 応答メッセージ。無料だが replyToken は約1分で失効する。 */
  async reply(replyToken: string, messages: LineMessage[]): Promise<void> {
    await this.call('/message/reply', { replyToken, messages: messages.slice(0, 5) });
  }

  /** プッシュメッセージ。課金対象なので必要最小限に。 */
  async push(to: string, messages: LineMessage[]): Promise<void> {
    await this.call('/message/push', { to, messages: messages.slice(0, 5) });
    await this.countAndWarn(to);
  }

  /**
   * 通数を数えて、区切りを越えたら知らせる。
   * ★知らせる行為でも1通使うが、それを数えると際限がないので数えない。
   * ★数える処理でこけても、本来の送信は成功しているので握りつぶす。
   */
  private async countAndWarn(to: string): Promise<void> {
    if (!this.kv) return;
    try {
      const { total, crossed } = await recordPush(this.kv);
      if (crossed === null) return;
      await this.call('/message/push', {
        to, messages: [{ type: 'text', text: buildQuotaWarning(total, crossed) }],
      });
      log.info('通数の警告を送りました', { total, crossed });
    } catch (e) {
      log.warn('通数の確認に失敗しました', String(e));
    }
  }

  /** ローディングアニメーション（生成中であることを伝える。無料）。 */
  async showLoading(userId: string, seconds = 60): Promise<void> {
    await this.call('/chat/loading/start', {
      chatId: userId,
      loadingSeconds: Math.min(60, Math.max(5, Math.round(seconds / 5) * 5)),
    });
  }

  /** 送られてきた画像の実体を取得する。 */
  async getContent(messageId: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
    const res = await fetch(`${CONTENT_API}/message/${encodeURIComponent(messageId)}/content`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) throw new Error(`LINE 画像取得に失敗しました (HTTP ${res.status})`);
    return {
      bytes: await res.arrayBuffer(),
      contentType: res.headers.get('content-type') ?? 'image/jpeg',
    };
  }
}

/** 簡単なテキストメッセージ。 */
export function text(t: string): LineMessage {
  return { type: 'text', text: t.slice(0, 4900) };
}

/** ボタン付きのテキスト（Quick Reply）。 */
export function textWithActions(
  t: string,
  actions: Array<{ label: string; data: string }>,
): LineMessage {
  return {
    type: 'text',
    text: t.slice(0, 4900),
    quickReply: {
      items: actions.slice(0, 13).map((a) => ({
        type: 'action',
        action: { type: 'postback', label: a.label.slice(0, 20), data: a.data, displayText: a.label },
      })),
    },
  };
}
