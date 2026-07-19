/**
 * Emit the list of live companies that are NOT hand-verified, ranked by market
 * cap, with the current integrity status of each. Written for the workflow
 * where a Sarmaaya snapshot is pasted per company: the ranking exists so the
 * effort stops at the point the remaining names stop mattering.
 *
 *   npx tsx scripts/generate-unverified-list.ts
 */
import { loadEnvLocal } from './load-env';
import { writeFileSync } from 'node:fs';
loadEnvLocal();

async function main(){
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const { activeUniverseTickers } = await import('@/lib/engine/universe');
  const { verifiedTickers } = await import('@/lib/engine/verified');
  const db = createAdminClient();
  const live = await activeUniverseTickers(db,'companies');
  const V = new Set(verifiedTickers());

  const page = async <T,>(t:string,c:string):Promise<T[]> => {
    const o:T[]=[]; for(let i=0;;i+=1000){const {data}=await db.from(t).select(c).range(i,i+999); if(!data?.length)break; o.push(...(data as T[])); if(data.length<1000)break;} return o; };

  const sm = await page<any>('stock_master','ticker,company_name,sector');
  const q  = await page<any>('market_quotes','ticker,market_cap,price,as_of');
  const fin= await page<any>('company_financials','ticker,fiscal_year,statement_type,review_status');
  const rat= await page<any>('company_ratios','ticker,ratio_name,source_period');

  const cap=new Map(q.map(r=>[r.ticker,Number(r.market_cap)||0]));
  const meta=new Map(sm.map(r=>[r.ticker,r]));
  const pe=new Map(rat.filter(r=>r.ratio_name==='P/E').map(r=>[r.ticker,r.source_period??'']));
  const latest=new Map<string,number>();
  for(const f of fin){ if(f.review_status!=='published')continue; if(f.statement_type!=='income_statement'&&f.statement_type!=='balance_sheet')continue;
    latest.set(f.ticker,Math.max(latest.get(f.ticker)??0,f.fiscal_year??0)); }

  const rows = live.filter(t=>!V.has(t))
    .map(t=>({ ticker:t, name:meta.get(t)?.company_name??'', sector:meta.get(t)?.sector??'',
               cap:cap.get(t)??0, year:latest.get(t)??0, basis:pe.get(t)??'' }))
    .sort((a,b)=>b.cap-a.cap);

  const status=(r:typeof rows[0]) => {
    if(!r.year) return 'NO DATA';
    if(r.year<2026) return `STALE FY${r.year}`;
    if(!r.basis) return 'no P/E';
    if(!r.basis.startsWith('TTM')) return `basis ${r.basis}`;
    return 'ok';
  };

  const B=(x:number)=>x>=1e9?(x/1e9).toFixed(1)+'B':x>0?(x/1e6).toFixed(0)+'M':'-';
  const total=rows.reduce((s,r)=>s+r.cap,0);

  let md=`# Unverified companies (${rows.length})\n\n`;
  md+=`Live universe 474, hand-verified 49, remaining ${rows.length}.\n`;
  md+=`Combined market cap of the remaining: ${B(total)}.\n\n`;
  md+=`Ranked by market cap. "status" is the current automated integrity result,\n`;
  md+=`not a verification: "ok" means the ratios compute on a sane basis, it does\n`;
  md+=`NOT mean the numbers have been checked against an external source.\n\n`;
  let cum=0;
  md+=`| # | ticker | company | sector | mkt cap | cum % | latest | status |\n|--:|---|---|---|--:|--:|--:|---|\n`;
  rows.forEach((r,i)=>{ cum+=r.cap;
    md+=`| ${i+1} | ${r.ticker} | ${r.name} | ${r.sector} | ${B(r.cap)} | ${(cum/total*100).toFixed(1)}% | ${r.year||'-'} | ${status(r)} |\n`; });
  writeFileSync('data/unverified-companies.md',md);

  writeFileSync('data/unverified-companies.csv',
    'rank,ticker,company,sector,market_cap,latest_fiscal_year,status\n'+
    rows.map((r,i)=>`${i+1},${r.ticker},"${r.name}","${r.sector}",${r.cap},${r.year||''},"${status(r)}"`).join('\n'));

  // tiers
  const tier=(n:number)=>{const s=rows.slice(0,n).reduce((a,r)=>a+r.cap,0);return `${(s/total*100).toFixed(0)}%`};
  console.log(`unverified: ${rows.length} companies, ${B(total)} combined\n`);
  console.log(`top 25  = ${tier(25)} of remaining cap`);
  console.log(`top 50  = ${tier(50)}`);
  console.log(`top 100 = ${tier(100)}`);
  console.log(`top 150 = ${tier(150)}`);
  const byStatus:Record<string,number>={};
  for(const r of rows){const s=status(r).split(' ')[0];byStatus[s]=(byStatus[s]||0)+1;}
  console.log(`\nstatus breakdown:`); for(const [k,v] of Object.entries(byStatus).sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(10)} ${v}`);
  console.log(`\nwritten: data/unverified-companies.md and .csv`);
  console.log(`\nTop 30:`);
  rows.slice(0,30).forEach((r,i)=>console.log(`${String(i+1).padStart(3)} ${r.ticker.padEnd(8)} ${B(r.cap).padStart(7)}  ${r.sector.slice(0,26).padEnd(26)} ${status(r)}`));
}
main().catch(e=>{console.error(e.message);process.exit(1)});
