// レート制限つきの取得ユーティリティ。
// - リクエスト間隔は1秒以上（SPEC 5.1）
// - User-Agent に連絡先を含める（環境変数 JADA_CONTACT で差し替え可能）
// - 取得した生ファイルは .cache/ に保存（コミット対象外。後から検証できるように）
import * as fs from 'node:fs';
import * as path from 'node:path';

const MIN_INTERVAL_MS = 1000;
let lastRequestAt = 0;

const CONTACT = process.env.JADA_CONTACT || 'contact-unset (set JADA_CONTACT env var)';
export const USER_AGENT =
  `who_is_EV_Top-data-bot/1.0 (+https://github.com/owlANDowlet0214/who_is_EV_Top; ${CONTACT})`;

export const CACHE_DIR = path.resolve(process.cwd(), '.cache');

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttle() {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

function cachePath(name: string) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  // ファイル名に使えない文字を潰す
  const safe = name.replace(/[^\w.\-]+/g, '_').slice(0, 180);
  const stamp = new Date().toISOString().slice(0, 10);
  return path.join(CACHE_DIR, `${stamp}__${safe}`);
}

export async function fetchText(url: string): Promise<string> {
  await throttle();
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  try { fs.writeFileSync(cachePath(url.split('/').pop() || 'page.html'), text); } catch { /* cache is best-effort */ }
  return text;
}

// バイナリ（xlsx/pdf）を取得し .cache/ に保存して Buffer を返す
export async function fetchBinary(url: string, cacheName: string): Promise<Buffer> {
  await throttle();
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  try { fs.writeFileSync(cachePath(cacheName), buf); } catch { /* best-effort */ }
  return buf;
}
