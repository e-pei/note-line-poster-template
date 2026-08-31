/**
 * LINE 公式アカウントの設定を、Worker 自身が行う。
 *
 * ★これまでは `scripts/setup-line.mjs`（顧客のパソコンで動かすコマンド）がやっていた。
 *   ターミナルを開かせないために、同じことを Worker の中でやる。
 *
 * ★Webhook の URL は、**このリクエストが届いた場所**から作る（引数で受け取る）。
 *   決め打ちにすると、他人の Worker を向けてしまう事故が起きる（過去に実際に埋め込んでいた）。
 */
import RICHMENU from '../../../assets/richmenu.json';
import { log } from '../../lib/mask';

const API = 'https://api.line.me/v2/bot';
const DATA_API = 'https://api-data.line.me/v2/bot';

/** このシステムが作るリッチメニューの名前。片付けの目印にする */
export const RICHMENU_NAME = 'note-line-poster';

/** メニュー画像の取得先。配布リポジトリは Public なので鍵なしで読める */
export const RICHMENU_IMAGE_URL =
  'https://raw.githubusercontent.com/e-pei/note-line-poster-template/main/assets/richmenu.png';

/** 1手順の結果。画面にそのまま並べられる形にしておく */
export interface Step {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface ProvisionResult {
  ok: boolean;
  steps: Step[];
  /** 設定した Webhook の URL（確認用） */
  webhookUrl?: string;
}

async function call(
  token: string, method: string, path: string, body?: unknown,
  opts: { base?: string; contentType?: string } = {},
): Promise<any> {
  const base = opts.base ?? API;
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let payload: BodyInit | undefined;

  if (body instanceof Uint8Array) {
    headers['Content-Type'] = opts.contentType ?? 'application/octet-stream';
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${base}${path}`, { method, headers, body: payload });
  const text = await res.text();
  if (!res.ok) {
    // ★トークンは絶対に混ぜない。返ってきた本文だけを見せる
    throw new Error(`LINE API ${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : {};
}

/**
 * Webhook の設定と疎通確認。
 *
 * ★配備した直後はアドレスが行き渡っていないことがある。
 *   1回で失敗と決めつけない（実際に「成功しているのに失敗表示」が起きた）。
 */
async function setupWebhook(token: string, origin: string, steps: Step[]): Promise<string> {
  const endpoint = `${origin.replace(/\/+$/, '')}/line/webhook`;

  await call(token, 'PUT', '/channel/webhook/endpoint', { endpoint });
  steps.push({ label: 'Webhook の設定', ok: true, detail: endpoint });

  let passed = false;
  let lastReason = '';
  for (let i = 0; i < 3; i++) {
    try {
      const test = await call(token, 'POST', '/channel/webhook/test', { endpoint });
      if (test.success === true || test.statusCode === 200) { passed = true; break; }
      lastReason = String(test.reason ?? test.detail ?? '');
    } catch (e) {
      lastReason = String(e);
    }
    if (i < 2) await new Promise((r) => setTimeout(r, 5_000));
  }

  steps.push(passed
    ? { label: 'LINE から届くかの確認', ok: true }
    : { label: 'LINE から届くかの確認', ok: false,
        detail: `${lastReason}（配備直後は数分かかることがあります。少し待ってからやり直してください）` });

  return endpoint;
}

/** リッチメニューを作り直して、全員の既定にする */
async function setupRichMenu(token: string, steps: Step[]): Promise<void> {
  let image: Uint8Array;
  try {
    const res = await fetch(RICHMENU_IMAGE_URL);
    if (!res.ok) throw new Error(`画像を取得できません (${res.status})`);
    image = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    steps.push({ label: 'メニュー画像の取得', ok: false, detail: String(e) });
    return;
  }

  if (image.length > 1024 * 1024) {
    steps.push({ label: 'メニュー画像の確認', ok: false, detail: '1MB を超えています（LINE に弾かれます）' });
    return;
  }

  // 作り直す前に、いまあるものを控えておく（新しいものを立ててから消す）
  const { richmenus = [] } = await call(token, 'GET', '/richmenu/list');
  const ours = richmenus.filter((m: { name?: string }) => m.name === RICHMENU_NAME);

  const created = await call(token, 'POST', '/richmenu', RICHMENU);
  await call(token, 'POST', `/richmenu/${created.richMenuId}/content`, image,
    { base: DATA_API, contentType: 'image/png' });
  await call(token, 'POST', `/user/all/richmenu/${created.richMenuId}`);
  steps.push({ label: 'メニューの作成と既定への設定', ok: true });

  for (const old of ours) {
    await call(token, 'DELETE', `/richmenu/${old.richMenuId}`).catch(() => {});
  }
  if (ours.length > 0) {
    steps.push({ label: '古いメニューの片付け', ok: true, detail: `${ours.length}件` });
  }
}

/**
 * LINE 側の設定をまとめて行う。
 *
 * @param origin このシステム自身の住所（`https://〇〇.workers.dev`）
 */
export async function provisionLine(token: string, origin: string): Promise<ProvisionResult> {
  const steps: Step[] = [];
  let webhookUrl: string | undefined;

  try {
    const me = await call(token, 'GET', '/info');
    steps.push({ label: 'LINE への接続', ok: true, detail: `${me.displayName ?? ''} ${me.basicId ?? ''}`.trim() });
  } catch (e) {
    steps.push({ label: 'LINE への接続', ok: false, detail: String(e) });
    return { ok: false, steps };
  }

  try {
    webhookUrl = await setupWebhook(token, origin, steps);
    await setupRichMenu(token, steps);
  } catch (e) {
    log.warn('LINE の設定でつまずきました', String(e));
    steps.push({ label: '設定の続行', ok: false, detail: String(e) });
  }

  return { ok: steps.every((s) => s.ok), steps, webhookUrl };
}
