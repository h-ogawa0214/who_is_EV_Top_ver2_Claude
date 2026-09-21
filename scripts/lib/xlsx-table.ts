// xlsx を「セル文字列の2次元配列」に落とし、ヘッダー駆動で行・列を探すための汎用ヘルパー。
// 列位置のハードコードを避ける（SPEC 5.1）。ここはレイアウト非依存の部品で、
// 「どのラベルを探すか」は jada-config.ts が持つ。
import * as XLSX from 'xlsx';

export type Matrix = string[][]; // 各セルはトリム済み文字列（空は ''）

export function workbookToMatrices(buf: Buffer): Record<string, Matrix> {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const out: Record<string, Matrix> = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false, defval: '' });
    out[name] = rows.map((r) => r.map((c) => normalize(c)));
  }
  return out;
}

// 全角数字・カンマ・空白を吸収して数値化。数値でなければ null。
export function toNumber(s: string): number | null {
  if (s == null) return null;
  const z = String(s)
    .replace(/[０-９]/g, (d) => String('０１２３４５６７８９'.indexOf(d)))
    .replace(/[，,\s\u3000]/g, '')
    .replace(/△▲/g, '-'); // 会計表記のマイナス
  if (z === '' || z === '-') return null;
  const n = Number(z);
  return Number.isFinite(n) ? n : null;
}

export function normalize(v: any): string {
  if (v == null) return '';
  return String(v).replace(/\u3000/g, ' ').trim();
}

// ラベル候補のいずれかを含むセルの [row, col] を返す（最初の一致）。無ければ null。
export function findCell(m: Matrix, labels: string[]): [number, number] | null {
  for (let r = 0; r < m.length; r++) {
    for (let c = 0; c < m[r].length; c++) {
      const cell = m[r][c];
      if (!cell) continue;
      if (labels.some((l) => cell.replace(/\s/g, '').includes(l.replace(/\s/g, '')))) return [r, c];
    }
  }
  return null;
}

// 指定行の中で、ラベル候補を含む列インデックスを返す。無ければ -1。
export function findColInRow(row: string[], labels: string[]): number {
  for (let c = 0; c < row.length; c++) {
    const cell = row[c];
    if (cell && labels.some((l) => cell.replace(/\s/g, '').includes(l.replace(/\s/g, '')))) return c;
  }
  return -1;
}
