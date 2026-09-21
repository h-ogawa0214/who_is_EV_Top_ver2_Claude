// 月報「燃料別メーカー別登録台数（乗用車）」から EV(BEV) を取得する。
import type { FetchResult } from '../lib/types';
import { fetchText, fetchBinary } from '../lib/http';
import { workbookToMatrices } from '../lib/xlsx-table';
import { PAGE_URL, findMonthlyXlsx, extractMonthly } from '../jada-config';

// month 未指定なら「公表済みの最大月」を取得する。
export async function fetchMonthly(month?: number): Promise<FetchResult> {
  let html: string;
  try {
    html = await fetchText(PAGE_URL);
  } catch (e: any) {
    return { status: 'failed', reason: `ページ取得に失敗: ${e.message}` };
  }

  const found = findMonthlyXlsx(html);
  if (!found) {
    return { status: 'failed', reason: '月報 xlsx のリンクをページから発見できませんでした（書式変更の可能性）' };
  }
  const { url, year, throughMonth } = found;

  if (month != null && month > throughMonth) {
    return { status: 'skipped', reason: `${year}年${month}月はまだ公表されていません（現在 ${throughMonth}月まで）` };
  }

  let buf: Buffer;
  try {
    buf = await fetchBinary(url, `jada-monthly-${year}-${throughMonth}.xlsx`);
  } catch (e: any) {
    return { status: 'failed', reason: `月報 xlsx の取得に失敗: ${e.message}` };
  }

  let matrices;
  try {
    matrices = workbookToMatrices(buf);
  } catch (e: any) {
    return { status: 'failed', reason: `xlsx のパースに失敗: ${e.message}` };
  }

  const parsed = extractMonthly(matrices, { month, throughMonth });
  if (!parsed) {
    return { status: 'failed', reason: 'xlsx から EV 列またはメーカー行を特定できませんでした（レイアウト変更の可能性。scripts/inspect.ts で確認）' };
  }

  return {
    status: 'ok',
    year,
    month: parsed.month,
    values: parsed.values,
    sourceUrl: url,
    fetchedAt: new Date().toISOString(),
  };
}
