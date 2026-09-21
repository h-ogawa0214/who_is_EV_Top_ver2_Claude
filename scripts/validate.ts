// SPEC 第4.2節の不変条件と、第5.3節の異常値検知。
// - 違反（error）があれば非ゼロ終了
// - warning はPR本文に載せるだけでブロックしない
import * as fs from 'node:fs';
import type { EvData } from './lib/types';

export interface ValidationReport { errors: string[]; warnings: string[]; }

const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const setEq = (a: string[], b: string[]) => a.length === b.length && a.every((k) => b.includes(k));
const yearTotal = (data: EvData, y: string) =>
  Object.values(data.years[y]).reduce((s, v) => s + v, 0);

export function validate(data: EvData, baseline?: EvData): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const makerKeys = Object.keys(data.makers).sort();

  // 1) years[Y] のキー = makers のキー
  for (const y of Object.keys(data.years)) {
    if (!setEq(Object.keys(data.years[y]).sort(), makerKeys)) {
      errors.push(`[不変1] years.${y} のキーが makers と一致しません`);
    }
    // 2) 台・整数
    for (const [k, v] of Object.entries(data.years[y])) {
      if (!Number.isInteger(v)) errors.push(`[不変2] years.${y}.${k} が整数ではありません（${v}）`);
    }
  }

  // 3) months[Y] 行キー = makers のキー（m を除く）
  for (const y of Object.keys(data.months || {})) {
    for (const row of data.months[y]) {
      const keys = Object.keys(row).filter((k) => k !== 'm').sort();
      if (!setEq(keys, makerKeys)) errors.push(`[不変3] months.${y} の ${row.m}月 の行キーが makers と一致しません`);
      for (const [k, v] of Object.entries(row)) {
        if (k !== 'm' && !Number.isInteger(v as number)) errors.push(`[不変2] months.${y} ${row.m}月 ${k} が整数ではありません（${v}）`);
      }
    }
  }

  // 4) months[Y] の各メーカー合計 = years[Y] の同メーカー値（部分年の整合性・最重要）
  //    「部分年」= partial に載っている年のみ。年次確定値で上書きされた（partialから外れた）
  //    年は、自販連の遡及修正で月次合計と食い違いうるため検査対象外（SPEC 5.2/7）。
  for (const y of Object.keys(data.months || {})) {
    if (!data.partial?.[y]) continue;
    if (!data.years[y]) { errors.push(`[不変4] months.${y} に対応する years.${y} がありません`); continue; }
    for (const k of makerKeys) {
      const msum = data.months[y].reduce((s, r) => s + (Number(r[k]) || 0), 0);
      if (msum !== data.years[y][k]) {
        errors.push(`[不変4] ${y}年 ${k}: 月次合計 ${msum} ≠ 年値 ${data.years[y][k]}`);
      }
    }
  }

  // 5) partial[Y].throughMonth = months[Y] の要素数
  for (const y of Object.keys(data.partial || {})) {
    const n = (data.months?.[y] || []).length;
    if (data.partial[y].throughMonth !== n) {
      errors.push(`[不変5] partial.${y}.throughMonth=${data.partial[y].throughMonth} が months.${y} の月数 ${n} と不一致`);
    }
  }
  // 逆：12か月そろっているのに partial に残っている
  for (const y of Object.keys(data.months || {})) {
    if ((data.months[y].length >= 12) && data.partial?.[y]) {
      errors.push(`[不変5] ${y}年は12か月そろっているのに partial に残っています（部分年ではない）`);
    }
  }

  // 6) trendMax > 年合計の最大値
  const maxTotal = Math.max(...Object.keys(data.years).map((y) => yearTotal(data, y)));
  if (!(data.meta.trendMax > maxTotal)) {
    errors.push(`[不変6] meta.trendMax=${data.meta.trendMax} が 年合計の最大 ${maxTotal} を上回っていません（人手で引き上げが必要）`);
  }

  // 7) display の系列がすべて makers に存在
  for (const k of [...data.display.trendSeries, ...data.display.monthlyOrder]) {
    if (k !== 'total' && !data.makers[k]) errors.push(`[不変7] display に未知のメーカー "${k}" が含まれています`);
  }

  // 9) updated は ISO 8601 日付
  if (!isIso(data.meta.updated)) errors.push(`[不変9] meta.updated が ISO 8601 日付ではありません（${data.meta.updated}）`);

  // 8) 既存データを削除していない（baseline がある場合）
  if (baseline) {
    for (const y of Object.keys(baseline.years)) {
      if (!data.years[y]) errors.push(`[不変8] 既存の years.${y} が削除されています`);
    }
    for (const y of Object.keys(baseline.months || {})) {
      const has = new Set((data.months?.[y] || []).map((r) => r.m));
      for (const r of baseline.months[y]) {
        if (!has.has(r.m)) errors.push(`[不変8] 既存の months.${y} ${r.m}月 が削除されています`);
      }
    }
  }

  // ---- 異常値検知（SPEC 5.3） ----
  // 月次を年またぎで時系列に並べ、連続する月を比較
  const flat: { y: string; m: number; row: Record<string, number> }[] = [];
  for (const y of Object.keys(data.months || {}).sort()) {
    for (const r of [...data.months[y]].sort((a, b) => a.m - b.m)) flat.push({ y, m: r.m, row: r as any });
  }
  for (let i = 0; i < flat.length; i++) {
    for (const k of makerKeys) {
      const now = Number(flat[i].row[k]) || 0;
      if (now < 0) errors.push(`[異常] ${flat[i].y}年${flat[i].m}月 ${k} が負値（${now}）`);
      if (i > 0) {
        const prev = Number(flat[i - 1].row[k]) || 0;
        if (prev > 0 && now >= prev * 20) {
          errors.push(`[異常] ${flat[i].y}年${flat[i].m}月 ${k}: 前月比 ${(now / prev).toFixed(0)}倍（単位・桁間違いの疑い）`);
        }
        if (prev > 0) {
          const change = (now - prev) / prev;
          if (Math.abs(change) > 0.6) {
            warnings.push(`${k}: ${flat[i].y}年${flat[i].m}月 前月比 ${(change * 100 >= 0 ? '+' : '') + (change * 100).toFixed(1)}%（前月 ${prev} → 当月 ${now}）`);
          }
        }
      }
    }
  }
  // 年合計が前年の3倍超
  const yrs = Object.keys(data.years).sort();
  for (let i = 1; i < yrs.length; i++) {
    const prev = yearTotal(data, yrs[i - 1]);
    const now = yearTotal(data, yrs[i]);
    if (prev > 0 && now > prev * 3) {
      errors.push(`[異常] ${yrs[i]}年の合計 ${now} が前年 ${prev} の3倍超`);
    }
  }

  return { errors, warnings };
}

// ---- CLI ----
function loadJson(p: string): EvData { return JSON.parse(fs.readFileSync(p, 'utf8')); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--')) || 'ev-registrations.json';
  const baseArg = args.find((a) => a.startsWith('--baseline='));
  const baseline = baseArg ? loadJson(baseArg.split('=')[1]) : undefined;

  const report = validate(loadJson(file), baseline);
  for (const w of report.warnings) console.log('⚠️  ' + w);
  for (const e of report.errors) console.error('❌ ' + e);
  if (report.errors.length) {
    console.error(`\nvalidate: ${report.errors.length} 件のエラー。`);
    process.exit(1);
  }
  console.log(`validate: OK（警告 ${report.warnings.length} 件）`);
}
