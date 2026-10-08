// 取得結果を ev-registrations.json にマージする。SPEC 第5.2節。
//
//   months を唯一の入力とし、years[Y] は months[Y] の合計から再計算する
//   （→ 不変条件4が構造的に保たれる）。
//
// 使い方:
//   tsx scripts/update-data.ts                 … 月報の最新月を取得してマージ
//   tsx scripts/update-data.ts --month 9       … 指定月を取得
//   tsx scripts/update-data.ts --annual 2025   … 年次確定値で上書き
//   tsx scripts/update-data.ts --input res.json … 取得をスキップし FetchResult[] を適用（テスト/dispatch）
//   （--dry-run で書き込まない、--data <path> で対象JSONを差し替え）
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EvData, FetchResult, FetchOk } from './lib/types';
import { validate } from './validate';

const MONTH_LABEL = (through: number) => `1〜${through}月`;

function loadJson<T>(p: string): T { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function clone<T>(o: T): T { return JSON.parse(JSON.stringify(o)); }
function deepEq(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }

function recalcYearFromMonths(data: EvData, y: string) {
  const makerKeys = Object.keys(data.makers);
  const acc: Record<string, number> = {};
  for (const k of makerKeys) acc[k] = 0;
  for (const row of data.months[y]) for (const k of makerKeys) acc[k] += Number(row[k]) || 0;
  data.years[y] = acc;
}

function regenSourceDetail(data: EvData): string {
  const finalized = Object.keys(data.years)
    .filter((y) => !data.partial?.[y]).map(Number).sort((a, b) => a - b);
  const parts: string[] = [];
  if (finalized.length) parts.push(`年別統計 ${finalized[0]}年〜${finalized[finalized.length - 1]}年`);
  const partials = Object.keys(data.partial || {}).sort();
  const monthlyStr = partials.map((y) => `${y}年1月〜${data.partial[y].throughMonth}月`).join('・');
  if (monthlyStr) parts.push(`燃料別メーカー別登録台数 月報 ${monthlyStr}`);
  return `（${parts.join('／')}）`;
}

export interface ApplyLog { updatedPeriods: string[]; warnings: string[]; monthly?: { year: number; month: number }; }

// 取得結果を適用した新しいデータを返す純粋処理（IO/検証は呼び出し側）。
// failed が含まれる場合は例外を投げる。
export function applyResults(before: EvData, results: FetchResult[]): { data: EvData; log: ApplyLog; srcUrl: string } {
  const failed = results.find((r) => r.status === 'failed');
  if (failed && failed.status === 'failed') throw new Error('取得失敗: ' + failed.reason);
  const data = clone(before);
  const log: ApplyLog = { updatedPeriods: [], warnings: [] };
  let srcUrl = '';
  for (const r of results) {
    if (r.status !== 'ok') continue;
    srcUrl = r.sourceUrl || srcUrl;
    if (r.month != null) applyMonthly(data, r, log);
    else applyAnnual(data, r, log);
  }
  data.meta.updated = new Date().toISOString().slice(0, 10);
  data.meta.sourceDetail = regenSourceDetail(data);
  return { data, log, srcUrl };
}

function applyMonthly(data: EvData, res: FetchOk, log: ApplyLog) {
  const y = String(res.year);
  const month = res.month!;
  if (!data.months[y]) data.months[y] = [];
  const rows = data.months[y];
  const idx = rows.findIndex((r) => r.m === month);
  const newRow: any = { m: month };
  for (const k of Object.keys(data.makers)) newRow[k] = res.values[k] ?? 0;
  if (idx >= 0) rows[idx] = newRow; else rows.push(newRow);
  rows.sort((a, b) => a.m - b.m);

  recalcYearFromMonths(data, y);

  const maxMonth = Math.max(...rows.map((r) => r.m));
  if (rows.length >= 12) {
    // 12か月そろった → 部分年ではなくなる
    if (data.partial?.[y]) delete data.partial[y];
  } else {
    data.partial = data.partial || {};
    data.partial[y] = { throughMonth: maxMonth, label: MONTH_LABEL(maxMonth) };
  }
  log.updatedPeriods.push(`${y}年${month}月（月報）`);
  log.monthly = { year: res.year, month };
}

function applyAnnual(data: EvData, res: FetchOk, log: ApplyLog) {
  const y = String(res.year);
  const values: Record<string, number> = {};
  for (const k of Object.keys(data.makers)) values[k] = res.values[k] ?? 0;

  // 月次合計との食い違いを検出（自販連の遡及修正など）→ 年次を正とし警告
  if (data.months?.[y]?.length) {
    for (const k of Object.keys(data.makers)) {
      const msum = data.months[y].reduce((s, r) => s + (Number(r[k]) || 0), 0);
      if (msum !== values[k]) {
        log.warnings.push(`${k}: 年次確定 ${values[k]} が月次合計 ${msum} と不一致（年次で上書き。自販連の遡及修正の可能性）`);
      }
    }
    // 確定年として扱う → partial から外す
    if (data.partial?.[y]) delete data.partial[y];
  }
  data.years[y] = values;
  log.updatedPeriods.push(`${y}年（年別統計・確定値）`);
}

function buildPrBody(data: EvData, before: EvData, log: ApplyLog, srcUrl: string, warnings: string[]): string {
  const lines: string[] = [];
  lines.push('## 追加された期間', log.updatedPeriods.join(' / ') || '（なし）', '');

  if (log.monthly) {
    const y = String(log.monthly.year), m = log.monthly.month;
    const cur = data.months[y].find((r) => r.m === m)!;
    const prevRow = data.months[y].find((r) => r.m === m - 1)
      || (before.months?.[y] || []).find((r) => r.m === m);
    lines.push('## 値', '| メーカー | 今月 | 前月 | 増減 |', '| --- | --- | --- | --- |');
    for (const k of Object.keys(data.makers)) {
      const now = Number(cur[k]) || 0;
      const prev = prevRow ? Number((prevRow as any)[k]) || 0 : null;
      const delta = prev == null || prev === 0 ? '—' : ((now - prev) / prev * 100 >= 0 ? '+' : '') + ((now - prev) / prev * 100).toFixed(1) + '%';
      lines.push(`| ${data.makers[k].short} | ${now.toLocaleString('en-US')} | ${prev == null ? '—' : prev.toLocaleString('en-US')} | ${delta} |`);
    }
    lines.push('');
    // 年累計
    const total = Object.values(data.years[y]).reduce((s, v) => s + v, 0);
    const prevFull = data.years[String(log.monthly.year - 1)];
    const prevTotal = prevFull ? Object.values(prevFull).reduce((s, v) => s + v, 0) : null;
    const label = data.partial?.[y]?.label || '通年';
    lines.push(`## 年累計（${y}年${label}）`,
      `${total.toLocaleString('en-US')}台` + (prevTotal ? `（前年通年比 ${(total / prevTotal).toFixed(2)}倍）` : ''), '');
  }

  lines.push('## 警告');
  if (warnings.length) warnings.forEach((w) => lines.push(`- ${w}`));
  else lines.push('- なし');
  lines.push('');

  const today = new Date().toISOString().slice(0, 10);
  lines.push('## 出典', `${srcUrl || data.meta.sourceUrl} （取得日 ${today}）`);
  return lines.join('\n');
}

function setOutput(kv: Record<string, string>) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  fs.appendFileSync(out, Object.entries(kv).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
}

async function gatherResults(args: string[]): Promise<FetchResult[]> {
  const inputArg = args.find((a) => a.startsWith('--input='));
  if (inputArg) return loadJson<FetchResult[]>(inputArg.split('=')[1]);

  const results: FetchResult[] = [];
  const annualArg = args.find((a) => a.startsWith('--annual='));
  const monthArg = args.find((a) => a.startsWith('--month='));
  if (annualArg) {
    const { fetchAnnual } = await import('./fetch/jada-annual');
    results.push(await fetchAnnual(Number(annualArg.split('=')[1])));
  } else {
    const { fetchMonthly } = await import('./fetch/jada-monthly');
    results.push(await fetchMonthly(monthArg ? Number(monthArg.split('=')[1]) : undefined));
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const dataPath = (args.find((a) => a.startsWith('--data='))?.split('=')[1]) || 'ev-registrations.json';
  const dryRun = args.includes('--dry-run');
  const prBodyPath = args.find((a) => a.startsWith('--pr-body='))?.split('=')[1] || 'pr-body.md';

  const before = loadJson<EvData>(dataPath);
  const results = await gatherResults(args);

  results.filter((r) => r.status === 'skipped').forEach((r: any) => console.log('⏭️  skip: ' + r.reason));

  // failed が1つでもあれば PR を作らず失敗（ソースは1つ＝失敗は全滅）
  let applied;
  try {
    applied = applyResults(before, results);
  } catch (e: any) {
    console.error('❌ ' + e.message);
    setOutput({ failed: 'true', changed: 'false' });
    process.exit(1);
    return;
  }
  const { data, log, srcUrl } = applied;

  // 変更なし（＝同月データが既にある等）→ PRを作らず正常終了
  if (deepEq(before, data)) {
    console.log('差分なし。PRは作成しません。');
    setOutput({ changed: 'false' });
    return;
  }

  // 検証（手動編集分も含め、ここで機械チェック。baseline=適用前でデータ削除も検査）
  const report = validate(data, before);
  report.warnings.forEach((w) => log.warnings.push(w));
  if (report.errors.length) {
    report.errors.forEach((e) => console.error('❌ ' + e));
    console.error('検証エラーのため中断します。');
    setOutput({ failed: 'true', changed: 'false' });
    process.exit(1);
  }

  const prBody = buildPrBody(data, before, log, srcUrl, log.warnings);

  if (!dryRun) {
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n');
    fs.writeFileSync(prBodyPath, prBody + '\n');
  }
  console.log('更新期間: ' + (log.updatedPeriods.join(' / ') || '（なし）'));
  console.log('警告: ' + (log.warnings.length || 0) + '件');
  console.log('\n--- PR body ---\n' + prBody);

  const branch = log.monthly
    ? `data/jada-${log.monthly.year}-${String(log.monthly.month).padStart(2, '0')}`
    : `data/jada-annual-${new Date().toISOString().slice(0, 7)}`;
  setOutput({
    changed: 'true',
    has_warnings: log.warnings.length ? 'true' : 'false',
    branch,
    pr_title: 'データ更新: ' + (log.updatedPeriods.join(' / ') || 'JADA'),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); setOutput({ failed: 'true', changed: 'false' }); process.exit(1); });
}
