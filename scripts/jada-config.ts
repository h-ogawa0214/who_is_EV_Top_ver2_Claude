// ============================================================================
//  自販連（JADA）固有の設定。取得ロジックのうち「サイトに依存する部分」を
//  この1ファイルに集約している。公表書式が変わったら、原則ここだけ直せばよい。
//
//  【確認済み（2026-09-21 時点、web で確認）】
//   - ページ: https://www.jada.or.jp/pages/342/  meta robots = index,follow
//   - 燃料別統計は「登録車（乗用車）のみ・軽自動車を含まない・日本メーカーの
//     海外生産車は輸入車に計上」。PDF と Excel(xlsx) の両方が公開されている。
//   - 月報 xlsx と 年別統計 xlsx が別々に置かれ、ファイルURLは
//     /files/libs/<id>/<timestamp>.xlsx 形式で毎回変わる（→ HTMLから発見する）。
//   - パースは壊れにくい xlsx を主軸にする。PDF はフォールバック（未実装／手動）。
//
//  【要・実物確認（このリポジトリの管理者が初回に1度だけ）】
//   下の EV 列ラベル・メーカー行ラベル・月/年ヘッダーの判定は、ヘッダー駆動で
//   セル位置を固定していないが、シートの実レイアウトまでは検証できていない。
//   `tsx scripts/inspect.ts <xlsxのURL>` でシート内容をダンプし、必要なら
//   下のラベル配列や extractMonthly/extractAnnual の走査方法を調整すること。
// ============================================================================
import type { Matrix } from './lib/xlsx-table';
import { toNumber, findCell, findColInRow } from './lib/xlsx-table';

export const PAGE_URL = 'https://www.jada.or.jp/pages/342/';
export const ORIGIN = 'https://www.jada.or.jp';

// JSONの makerId -> シート上の表記ゆれ候補
export const MAKER_LABELS: Record<string, string[]> = {
  import:     ['輸入車', '輸入'],
  toyota:     ['トヨタ'],
  nissan:     ['日産', 'ニッサン'],
  honda:      ['ホンダ', '本田'],
  subaru:     ['スバル', 'SUBARU', 'ＳＵＢＡＲＵ', '富士重', '富士'],
  mazda:      ['マツダ', 'MAZDA', 'ＭＡＺＤＡ'],
  mitsubishi: ['三菱自', '三菱'],
};

// EV(BEV)列とみなすラベル。PHV/PHEV/HV/FCV/ガソリン等を巻き込まないよう除外語も持つ。
const EV_POSITIVE = ['ＢＥＶ', 'BEV', '電気自動車', 'ＥＶ', 'EV'];
const EV_NEGATIVE = ['PH', 'ＰＨ', 'HV', 'ＨＶ', 'FC', 'ＦＣ', 'ハイブリッド', 'プラグイン', '燃料電池', 'ガソリン', 'ディーゼル', 'ＬＰ', 'LP', 'CNG', 'ＣＮＧ'];

export function isEvHeader(cell: string): boolean {
  const s = cell.replace(/\s/g, '');
  if (!s) return false;
  if (EV_NEGATIVE.some((n) => s.includes(n.replace(/\s/g, '')))) return false;
  // 完全一致(EV/ＥＶ)か、BEV/電気自動車を含む
  if (s === 'EV' || s === 'ＥＶ') return true;
  return ['ＢＥＶ', 'BEV', '電気自動車'].some((p) => s.includes(p));
}

// ---- ページHTMLから対象ファイルURLを発見する（libsパスは毎回変わるため） ----
type Link = { href: string; text: string };
function extractLinks(html: string): Link[] {
  const out: Link[] = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(html))) {
    const href = mm[1];
    const text = mm[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    out.push({ href, text });
  }
  return out;
}
function absolutize(href: string): string {
  if (/^https?:\/\//.test(href)) return href;
  if (href.startsWith('/')) return ORIGIN + href;
  return ORIGIN + '/' + href;
}

// 月報 xlsx（例: 「燃料別登録台数統計（2026年1月～8月）」）
export function findMonthlyXlsx(html: string): { url: string; year: number; throughMonth: number } | null {
  const links = extractLinks(html);
  const re = /燃料別登録台数統計（\s*(\d{4})年\s*\d+月\s*[~～－-]\s*(\d+)月\s*）/;
  for (const l of links) {
    if (!/\.xlsx(\?|$)/i.test(l.href)) continue;
    const m = l.text.match(re);
    if (m) return { url: absolutize(l.href), year: Number(m[1]), throughMonth: Number(m[2]) };
  }
  return null;
}

// 年別統計 xlsx（例: 「年別統計（2021年～2025年）」）
export function findAnnualXlsx(html: string): { url: string; fromYear: number; toYear: number } | null {
  const links = extractLinks(html);
  const re = /年別統計（\s*(\d{4})年\s*[~～－-]\s*(\d{4})年\s*）/;
  for (const l of links) {
    if (!/\.xlsx(\?|$)/i.test(l.href)) continue;
    const m = l.text.match(re);
    if (m) return { url: absolutize(l.href), fromYear: Number(m[1]), toYear: Number(m[2]) };
  }
  return null;
}

// ---- シート走査（ヘッダー駆動。列位置は固定しない） ----

// 指定メーカー行 × EV列 の値を1シートから取り出す。
// makerId -> value（見つからなければキーを含めない）。EV列が見つからなければ null。
function readMakerEvValues(m: Matrix, evColHint?: number): Record<string, number> | null {
  // EV列を特定：ヘッダー行を上から探し、EVらしい列を1つ選ぶ
  let evCol = evColHint ?? -1;
  if (evCol < 0) {
    for (let r = 0; r < Math.min(m.length, 12); r++) {
      const c = m[r].findIndex((cell) => isEvHeader(cell));
      if (c >= 0) { evCol = c; break; }
    }
  }
  if (evCol < 0) return null;

  const values: Record<string, number> = {};
  for (const [id, labels] of Object.entries(MAKER_LABELS)) {
    const found = findCell(m, labels);
    if (!found) continue; // 行が無い＝0扱い（呼び出し側で補完）
    const [row] = found;
    const n = toNumber(m[row][evCol] ?? '');
    if (n != null) values[id] = Math.round(n);
  }
  return values;
}

/**
 * 年別統計 xlsx から、対象年の「メーカー別 EV 登録台数（乗用車）」を取り出す。
 * 戻り値は makerId -> 台数。全メーカーが取れなければ null（＝要フォールバック/失敗）。
 */
export function extractAnnual(matrices: Record<string, Matrix>, year: number): Record<string, number> | null {
  for (const [, m] of Object.entries(matrices)) {
    // 対象年のヘッダーがあるシート/表を優先
    const hasYear = findCell(m, [`${year}年`, `${year}`]) != null;
    if (!hasYear) continue;
    const values = readMakerEvValues(m);
    if (values && Object.keys(values).length >= 3) return normalizeMakers(values);
  }
  // 年ヘッダーが見つからない場合でも、最初に読めた表で試す
  for (const [, m] of Object.entries(matrices)) {
    const values = readMakerEvValues(m);
    if (values && Object.keys(values).length >= 3) return normalizeMakers(values);
  }
  return null;
}

/**
 * 月報 xlsx から、対象月の「メーカー別 EV 登録台数（乗用車）」を取り出す。
 * month 未指定なら「収録済みの最大月」を対象にする。
 * 戻り値 { month, values }。取れなければ null。
 */
export function extractMonthly(
  matrices: Record<string, Matrix>,
  opts: { month?: number; throughMonth: number },
): { month: number; values: Record<string, number> } | null {
  const target = opts.month ?? opts.throughMonth;

  // 1) 月ごとにシートが分かれている場合：シート名で対象月を選ぶ
  for (const [name, m] of Object.entries(matrices)) {
    if (matchesMonthLabel(name, target)) {
      const values = readMakerEvValues(m);
      if (values && Object.keys(values).length >= 3) return { month: target, values: normalizeMakers(values) };
    }
  }
  // 2) 1シートに月列が並ぶ場合：対象月の列を見つけ、その近傍のEV列を読む
  for (const [, m] of Object.entries(matrices)) {
    const monthCol = findMonthColumn(m, target);
    if (monthCol >= 0) {
      const values = readMakerEvValues(m, monthCol);
      if (values && Object.keys(values).length >= 3) return { month: target, values: normalizeMakers(values) };
    }
  }
  // 3) 最後の手段：EV列だけで読めるシート（単月ファイル想定）
  for (const [, m] of Object.entries(matrices)) {
    const values = readMakerEvValues(m);
    if (values && Object.keys(values).length >= 3) return { month: target, values: normalizeMakers(values) };
  }
  return null;
}

function matchesMonthLabel(label: string, month: number): boolean {
  const s = label.replace(/\s/g, '');
  return new RegExp(`(^|[^0-9０-９])${month}月`).test(s) || new RegExp(`0?${month}月`).test(s);
}
function findMonthColumn(m: Matrix, month: number): number {
  for (let r = 0; r < Math.min(m.length, 12); r++) {
    const c = findColInRow(m[r], [`${month}月`]);
    if (c >= 0) return c;
  }
  return -1;
}

// 取れなかったメーカーは 0 で補完（JSONの makers 全キーを常に埋めるため）
function normalizeMakers(values: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of Object.keys(MAKER_LABELS)) out[id] = values[id] ?? 0;
  return out;
}
