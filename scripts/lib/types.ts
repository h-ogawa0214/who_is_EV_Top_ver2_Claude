// ev-registrations.json のスキーマ型と、取得スクリプトの共通インターフェース。
// SPEC_auto_update_jada.md 第4節・第5.1節に対応。

export interface Meta {
  updated: string;       // ISO 8601 (YYYY-MM-DD)
  unit: string;          // "台"
  trendMax: number;
  source: string;
  sourceUrl: string;
  sourceDetail: string;  // 収録範囲。update-data が自動生成する
  note: string;
}

export interface PartialInfo {
  throughMonth: number;  // その年で収録済みの最大月
  label: string;         // 例 "1〜8月"
}

export interface MakerDef {
  name: string;
  short: string;
  origin: string;
  color: string;
  dark: string;
}

export interface MonthRow {
  m: number;             // 1..12
  [makerId: string]: number;
}

export interface EvData {
  meta: Meta;
  partial: Record<string, PartialInfo>;
  makers: Record<string, MakerDef>;
  years: Record<string, Record<string, number>>;
  months: Record<string, MonthRow[]>;
  display: { trendSeries: string[]; monthlyOrder: string[] };
}

// 取得結果。SPEC 第5.1節の共通インターフェース。
// values は「台・整数」。単位変換は fetch 側の責務。
export type FetchOk = {
  status: 'ok';
  year: number;
  month?: number;                    // 月報のとき指定。年次は未指定
  values: Record<string, number>;    // makerId -> 台数（整数）
  sourceUrl: string;
  fetchedAt: string;                 // ISO 8601 datetime
};
export type FetchSkipped = { status: 'skipped'; reason: string }; // 未公表・対象期間外
export type FetchFailed = { status: 'failed'; reason: string };   // 構造変化・通信エラー
export type FetchResult = FetchOk | FetchSkipped | FetchFailed;
