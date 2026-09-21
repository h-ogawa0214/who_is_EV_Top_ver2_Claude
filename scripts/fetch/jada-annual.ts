// 年別統計（確定値）から、対象年の EV(BEV) 登録台数を取得する。
import type { FetchResult } from '../lib/types';
import { fetchText, fetchBinary } from '../lib/http';
import { workbookToMatrices } from '../lib/xlsx-table';
import { PAGE_URL, findAnnualXlsx, extractAnnual } from '../jada-config';

export async function fetchAnnual(year: number): Promise<FetchResult> {
  let html: string;
  try {
    html = await fetchText(PAGE_URL);
  } catch (e: any) {
    return { status: 'failed', reason: `ページ取得に失敗: ${e.message}` };
  }

  const found = findAnnualXlsx(html);
  if (!found) {
    return { status: 'failed', reason: '年別統計 xlsx のリンクをページから発見できませんでした（書式変更の可能性）' };
  }
  const { url, fromYear, toYear } = found;

  if (year < fromYear || year > toYear) {
    return { status: 'skipped', reason: `${year}年は年別統計の収録範囲（${fromYear}〜${toYear}）外です` };
  }

  let buf: Buffer;
  try {
    buf = await fetchBinary(url, `jada-annual-${fromYear}-${toYear}.xlsx`);
  } catch (e: any) {
    return { status: 'failed', reason: `年別統計 xlsx の取得に失敗: ${e.message}` };
  }

  let matrices;
  try {
    matrices = workbookToMatrices(buf);
  } catch (e: any) {
    return { status: 'failed', reason: `xlsx のパースに失敗: ${e.message}` };
  }

  const values = extractAnnual(matrices, year);
  if (!values) {
    return { status: 'failed', reason: `${year}年の EV 値を xlsx から特定できませんでした（scripts/inspect.ts で確認）` };
  }

  return { status: 'ok', year, values, sourceUrl: url, fetchedAt: new Date().toISOString() };
}
