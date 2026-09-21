// canonical な ev-registrations.json を docs/ へコピーする。SPEC 3節・6.3節。
//   tsx scripts/sync-docs.ts          … docs/ へコピー
//   tsx scripts/sync-docs.ts --check  … 2ファイルの不一致を検出（CI用。差分あれば非ゼロ終了）
import * as fs from 'node:fs';

const SRC = 'ev-registrations.json';
const DST = 'docs/ev-registrations.json';

function normalized(p: string): string {
  // 整形の揺れを無視して内容だけ比較する
  return JSON.stringify(JSON.parse(fs.readFileSync(p, 'utf8')));
}

const check = process.argv.includes('--check');

if (check) {
  if (!fs.existsSync(DST)) { console.error(`❌ ${DST} が存在しません`); process.exit(1); }
  if (normalized(SRC) !== normalized(DST)) {
    console.error(`❌ ${SRC} と ${DST} の内容が一致しません。'tsx scripts/sync-docs.ts' を実行してください。`);
    process.exit(1);
  }
  console.log('sync-docs: OK（2ファイルは一致）');
} else {
  fs.mkdirSync('docs', { recursive: true });
  fs.copyFileSync(SRC, DST);
  console.log(`sync-docs: ${SRC} → ${DST} をコピーしました`);
}
