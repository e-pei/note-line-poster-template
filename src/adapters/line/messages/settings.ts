/**
 * 投稿まわりの設定画面（LINE）。
 *
 * ★レート制限は API 費用ではなく **note アカウントを守るため**のもの。
 *   note のクリエイター規約 10.1 は「スパムと note 社が判断した場合」
 *   予告なくアカウントを止められると定めている。上限を外すのは自由だが、
 *   何を引き受けることになるのかを、必ず本人に見える形で書く。
 */
import type { LineMessage } from '../client';
import type { TenantRow } from '../../../ports/storage/db';

export interface SettingsView {
  tenant: TenantRow;
  agentConnected: boolean;
  agentOnline: boolean;
}

function limitLabel(n: number): string {
  return n > 0 ? `1日 ${n} 本まで` : '無制限';
}

function intervalLabel(sec: number): string {
  if (sec <= 0) return 'なし（連続で投稿できます）';
  if (sec % 3600 === 0) return `${sec / 3600} 時間あけます`;
  return `${Math.round(sec / 60)} 分あけます`;
}

function modeLabel(v: SettingsView): string {
  if (v.tenant.execution_mode !== 'agent') {
    return 'このサーバーから（パソコンを開いていなくても投稿されます）';
  }
  const state = !v.agentConnected ? '未連携'
    : v.agentOnline ? '連携中・オンライン'
    : '連携中・オフライン';
  return `自分のパソコンから（${state}）`;
}

/** 設定の一覧。 */
export function buildSettings(v: SettingsView): LineMessage {
  const agent = v.tenant.execution_mode === 'agent';
  return {
    type: 'text',
    text:
      '【投稿の設定】\n\n' +
      '■ 投稿する場所\n' +
      `　 ${modeLabel(v)}\n\n` +
      '■ 1日の上限\n' +
      `　 ${limitLabel(v.tenant.daily_post_limit)}\n\n` +
      '■ 投稿の間隔\n' +
      `　 ${intervalLabel(v.tenant.min_interval_sec)}\n\n` +
      '────────\n' +
      (agent
        ? 'いまは、あなたのパソコンの Chrome から note に投稿しています。\n' +
          'パソコンが起動していないときは、起動後に自動で投稿します。'
        : 'いまは、このサーバーから note に投稿しています。\n' +
          'パソコンを開いていなくても、いつでも投稿できます。') +
      '\n\n下のボタンから変えられます。',
    quickReply: {
      items: [
        { type: 'action', action: { type: 'postback', label: '1日の上限', data: 'action=cfg_daily', displayText: '1日の上限を変える' } },
        { type: 'action', action: { type: 'postback', label: '投稿の間隔', data: 'action=cfg_interval', displayText: '投稿の間隔を変える' } },
        { type: 'action', action: { type: 'postback', label: '投稿する場所', data: 'action=cfg_mode', displayText: '投稿する場所を変える' } },
      ],
    },
  };
}

/** 1日の上限を選ぶ。 */
export function buildDailyLimitChoices(current: number): LineMessage {
  const options = [0, 1, 2, 3, 5, 10];
  return {
    type: 'text',
    text:
      '1日に投稿できる本数を選んでください。\n' +
      `いま: ${limitLabel(current)}\n\n` +
      '※ この上限は API の費用ではなく、note アカウントを守るためのものです。\n' +
      'note は「スパムと判断した場合、予告なくアカウントを停止できる」と規約に定めています。\n' +
      '無制限にする場合は、その前提でお使いください。',
    quickReply: {
      items: options.map((n) => ({
        type: 'action' as const,
        action: {
          type: 'postback' as const,
          label: n === 0 ? '無制限' : `${n}本`,
          data: `action=cfg_daily_set&v=${n}`,
          displayText: n === 0 ? '上限なしにする' : `1日${n}本までにする`,
        },
      })),
    },
  };
}

/** 投稿の間隔を選ぶ。 */
export function buildIntervalChoices(current: number): LineMessage {
  const options = [0, 600, 1800, 3600, 10800];
  return {
    type: 'text',
    text:
      '前の投稿から、どれくらいあけますか。\n' +
      `いま: ${intervalLabel(current)}\n\n` +
      '※ まとめて投稿したいときは「なし」を選んでください。',
    quickReply: {
      items: options.map((sec) => ({
        type: 'action' as const,
        action: {
          type: 'postback' as const,
          label: sec === 0 ? 'なし' : sec >= 3600 ? `${sec / 3600}時間` : `${sec / 60}分`,
          data: `action=cfg_interval_set&v=${sec}`,
          displayText: sec === 0 ? '間隔をあけない' : `${sec >= 3600 ? `${sec / 3600}時間` : `${sec / 60}分`}あける`,
        },
      })),
    },
  };
}

/** 投稿する場所を選ぶ。 */
export function buildModeChoices(v: SettingsView): LineMessage {
  return {
    type: 'text',
    text:
      'note への投稿を、どこから行いますか。\n\n' +
      '■ このサーバーから（おすすめ）\n' +
      '　 パソコンを開いていなくても、いつでも投稿できます。\n' +
      '　 このシステムはあなた専用に用意されているので、\n' +
      '　 ログイン情報がほかの人と混ざることはありません。\n\n' +
      '■ 自分のパソコンから\n' +
      '　 note から見て、あなたのパソコンからの投稿になります。\n' +
      '　 ログイン情報を保存せずに済みます。\n' +
      '　 ただし Chrome を開いていない間は、投稿が待機になります。' +
      (v.tenant.execution_mode === 'agent' && !v.agentConnected
        ? '\n\n※ いまは連携ツールが未接続です。「note連携」で先につないでください。'
        : ''),
    quickReply: {
      items: [
        { type: 'action', action: { type: 'postback', label: 'このサーバーから', data: 'action=cfg_mode_set&v=server', displayText: 'このサーバーから投稿する' } },
        { type: 'action', action: { type: 'postback', label: '自分のパソコンから', data: 'action=cfg_mode_set&v=agent', displayText: '自分のパソコンから投稿する' } },
      ],
    },
  };
}

/** 変更後の確認メッセージ。 */
export function buildSettingsSaved(kind: 'daily' | 'interval' | 'mode', v: SettingsView): LineMessage {
  const detail =
    kind === 'daily' ? `1日の上限を「${limitLabel(v.tenant.daily_post_limit)}」にしました。`
    : kind === 'interval' ? `投稿の間隔を「${intervalLabel(v.tenant.min_interval_sec)}」にしました。`
    : `投稿する場所を「${v.tenant.execution_mode === 'agent' ? '自分のパソコンから' : 'このサーバーから'}」にしました。`;

  const caution =
    kind === 'daily' && v.tenant.daily_post_limit === 0
      ? '\n\n上限なしにしました。note 側でスパムと判断されないよう、内容にはお気をつけください。'
      : kind === 'mode' && v.tenant.execution_mode === 'agent' && !v.agentConnected
        ? '\n\n連携ツールがまだ未接続です。「note連携」でつないでください。'
        : kind === 'mode' && v.tenant.execution_mode === 'server'
          ? '\n\nパソコンを開いていなくても投稿できるようになりました。\n' +
            'まだ note とつないでいない場合は「note連携」からお願いします。'
          : '';

  return { type: 'text', text: detail + caution };
}
