// 実物確認用ヘルパー。自販連の xlsx をダウンロードして、シート名と各シートの
// 先頭を行列でダンプする。EV列・メーカー行のラベルが jada-config.ts と合うか、
// これで初回に1度だけ確認する。
//   tsx scripts/inspect.ts <xlsxのURL>
//   tsx scripts/inspect.ts --page   … ページから月報/年次xlsxのURLを発見して両方ダンプ
import { fetchText, fetchBinary } from './lib/http';
import { workbookToMatrices } from './lib/xlsx-table';
import { PAGE_URL, findMonthlyXlsx, findAnnualXlsx, isEvHeader, MAKER_LABELS } from './jada-config';

function dump(buf: Buffer, title: string) {
  console.log(`\n===== ${title} =====`);
  const matrices = workbookToMatrices(buf);
  for (const [name, m] of Object.entries(matrices)) {
    console.log(`\n[sheet] ${name}  (${m.length}行)`);
    const evCols: number[] = [];
    m.slice(0, Math.min(m.length, 8)).forEach((row) => {
      row.forEach((c, i) => { if (isEvHeader(c) && !evCols.includes(i)) evCols.push(i); });
    });
    console.log('  EVらしき列:', evCols.length ? evCols.join(', ') : '（見つからず）');
    for (const [id, labels] of Object.entries(MAKER_LABELS)) {
      const r = m.findIndex((row) => row.some((c) => labels.some((l) => c.replace(/\s/g, '').includes(l.replace(/\s/g, '')))));
      console.log(`  行[${id}]:`, r >= 0 ? `${r}行目` : '（見つからず）');
    }
    console.log('  先頭6行:');
    m.slice(0, 6).forEach((row, i) => console.log(`   ${i}: ${row.slice(0, 12).join(' | ')}`));
  }
}

async function main() {
  const arg = process.argv[2];
  if (arg === '--page' || !arg) {
    const html = await fetchText(PAGE_URL);
    const mo = findMonthlyXlsx(html), an = findAnnualXlsx(html);
    console.log('月報 xlsx:', mo?.url || '（未発見）');
    console.log('年次 xlsx:', an?.url || '（未発見）');
    if (mo) dump(await fetchBinary(mo.url, 'inspect-monthly.xlsx'), `月報 ${mo.year}年1〜${mo.throughMonth}月`);
    if (an) dump(await fetchBinary(an.url, 'inspect-annual.xlsx'), `年次 ${an.fromYear}〜${an.toYear}`);
  } else {
    dump(await fetchBinary(arg, 'inspect.xlsx'), arg);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
