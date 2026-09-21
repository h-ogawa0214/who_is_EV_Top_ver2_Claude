// オフラインで実行できる受け入れテスト（SPEC 第6節のうちライブ取得を要さないもの）。
//   tsx scripts/test/run.ts
import * as XLSX from 'xlsx';
import type { EvData, FetchResult } from '../lib/types';
import { validate } from '../validate';
import { applyResults } from '../update-data';
import { workbookToMatrices } from '../lib/xlsx-table';
import { extractMonthly, extractAnnual, isEvHeader } from '../jada-config';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.error(`❌ ${name} ${extra}`); }
}

// 最小の有効データ（2025確定＋2026を1〜2月だけ持つ部分年）
function baseData(): EvData {
  return {
    meta: { updated: '2026-03-01', unit: '台', trendMax: 80000,
      source: 'JADA', sourceUrl: 'https://www.jada.or.jp/pages/342/', sourceDetail: '', note: 'x' },
    partial: { '2026': { throughMonth: 2, label: '1〜2月' } },
    makers: {
      import: { name: '輸入車（合計）', short: '輸入車', origin: '海外', color: '#e8503a', dark: '#7a2418' },
      toyota: { name: 'トヨタ', short: 'トヨタ', origin: '日本', color: '#5aa9ff', dark: '#1f4d80' },
      nissan: { name: '日産', short: '日産', origin: '日本', color: '#3ddc97', dark: '#1c6b4c' },
      honda: { name: 'ホンダ', short: 'ホンダ', origin: '日本', color: '#a78bfa', dark: '#4c3a86' },
      subaru: { name: 'SUBARU', short: 'SUBARU', origin: '日本', color: '#58e0e8', dark: '#17595e' },
      mazda: { name: 'マツダ', short: 'マツダ', origin: '日本', color: '#ff9ecb', dark: '#7a4a63' },
      mitsubishi: { name: '三菱', short: '三菱', origin: '日本', color: '#ffcf5c', dark: '#7a5f17' },
    },
    years: {
      '2025': { import: 30458, toyota: 4203, nissan: 4875, honda: 10, subaru: 330, mazda: 9, mitsubishi: 0 },
      '2026': { import: 4901, toyota: 3785, nissan: 2781, honda: 0, subaru: 197, mazda: 0, mitsubishi: 0 },
    },
    months: {
      '2026': [
        { m: 1, import: 2209, toyota: 1694, nissan: 1436, honda: 0, subaru: 80, mazda: 0, mitsubishi: 0 },
        { m: 2, import: 2692, toyota: 2091, nissan: 1345, honda: 0, subaru: 117, mazda: 0, mitsubishi: 0 },
      ],
    },
    display: { trendSeries: ['import', 'toyota', 'nissan', 'honda'], monthlyOrder: ['import', 'toyota', 'nissan', 'honda', 'subaru'] },
  };
}

// --- 受入#1 相当: base は検証を通る ---
ok('base データは検証を通る', validate(baseData()).errors.length === 0);

// --- 受入#2: 月を1つ追加すると years が月次合計で再計算され不変条件4が保たれる ---
{
  const before = baseData();
  const res: FetchResult[] = [{ status: 'ok', year: 2026, month: 3,
    values: { import: 4777, toyota: 3456, nissan: 2629, honda: 0, subaru: 383, mazda: 0, mitsubishi: 0 },
    sourceUrl: 'x', fetchedAt: new Date().toISOString() }];
  const { data } = applyResults(before, res);
  const t = data.years['2026'].toyota;
  ok('#2 years.2026.toyota が月次合計に再計算 (1694+2091+3456=7241)', t === 7241, `got ${t}`);
  ok('#2 partial.2026.throughMonth=3', data.partial['2026'].throughMonth === 3);
  ok('#2 追加後も検証を通る（不変条件4を含む）', validate(data, before).errors.length === 0);
}

// --- 受入#3: 12か月そろうと partial から当該年が消える ---
{
  let data = baseData();
  data.meta.trendMax = 200000; // 12か月合計が増えるため、このシナリオでは上げておく
  for (let m = 3; m <= 12; m++) {
    const res: FetchResult[] = [{ status: 'ok', year: 2026, month: m,
      values: { import: 3000, toyota: 2000, nissan: 1500, honda: 500, subaru: 200, mazda: 10, mitsubishi: 5 },
      sourceUrl: 'x', fetchedAt: new Date().toISOString() }];
    data = applyResults(data, res).data;
  }
  ok('#3 12か月そろうと partial.2026 が消える', !data.partial['2026']);
  ok('#3 その後も検証を通る', validate(data).errors.length === 0);
}

// --- 受入#5: 単位・桁間違いで validate が停止する ---
{
  // (a) 小数（万台換算の名残）→ 不変条件2
  const d1 = baseData(); (d1.months['2026'][1] as any).toyota = 20.9; d1.years['2026'].toyota = 1694 + 20;
  ok('#5a 小数値で validate が error', validate(d1).errors.some((e) => e.includes('[不変2]')));
  // (b) 桁間違い（台数を万台のつもりで巨大化）→ 前月比20倍以上の異常
  const d2 = baseData();
  (d2.months['2026'][1] as any).toyota = 2091 * 25; // 前月1694に対し ~30倍
  d2.years['2026'].toyota = 1694 + 2091 * 25;
  ok('#5b 桁間違いで validate が error（20倍検知）', validate(d2).errors.some((e) => e.includes('[異常]')));
}

// --- 受入#6 相当: 削除検知（不変条件8） ---
{
  const before = baseData();
  const after = baseData(); delete (after.years as any)['2025'];
  ok('#8 既存年の削除を検知', validate(after, before).errors.some((e) => e.includes('[不変8]')));
}

// --- 受入#4 相当: パーサはヘッダー駆動で読め、壊れた表では null（→ 失敗） ---
{
  // JADA風の燃料別シート（EV列はＥＶ、PHVは除外されること）
  const aoa = [
    ['メーカー', 'ガソリン', 'ハイブリッド', 'ＰＨＶ', 'ＥＶ', 'ＦＣＶ', '合計'],
    ['トヨタ', 100000, 50000, 3000, 2017, 5, 155022],
    ['日産', 20000, 8000, 100, 1437, 0, 29537],
    ['ホンダ', 30000, 12000, 0, 385, 0, 42385],
    ['スバル', 9000, 3000, 0, 556, 0, 12556],
    ['マツダ', 8000, 1000, 0, 0, 0, 9000],
    ['三菱', 5000, 500, 0, 0, 0, 5500],
    ['輸入車', 40000, 5000, 800, 3956, 30, 49786],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '8月');
  const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  const matrices = workbookToMatrices(buf);
  ok('parser: ＥＶ をEV列と判定', isEvHeader('ＥＶ') === true);
  ok('parser: ＰＨＶ はEV列に含めない', isEvHeader('ＰＨＶ') === false);
  const parsed = extractMonthly(matrices, { month: 8, throughMonth: 8 });
  ok('#4 正常な表から toyota=2017 を取得', parsed?.values.toyota === 2017, JSON.stringify(parsed?.values));
  ok('#4 正常な表から import=3956 を取得', parsed?.values.import === 3956);

  // 壊れた表（EV列ラベルなし）→ null（fetcher はこれを failed に変換する）
  const broken = [['メーカー', 'A', 'B', 'C'], ['トヨタ', 1, 2, 3]];
  const wb2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet(broken), 'S');
  const buf2 = Buffer.from(XLSX.write(wb2, { type: 'buffer', bookType: 'xlsx' }));
  const parsed2 = extractMonthly(workbookToMatrices(buf2), { month: 8, throughMonth: 8 });
  ok('#4 EV列のない表では null（→ failed 相当）', parsed2 === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
