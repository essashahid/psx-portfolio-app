/**
 * Find companies whose CONSOLIDATED figures reconcile with Sarmaaya where the
 * unconsolidated ones do not.
 *
 * The ratio engine computes unconsolidated throughout, to match the PSX portal
 * annual series. That is right for an operating company and wrong for a group
 * holding company, where the parent's standalone accounts describe almost
 * nothing and the market quotes the group. NATF is the clean example:
 * consolidated 9M EPS 108.66 against Sarmaaya 110.99, while our unconsolidated
 * 23.71 looks like a different company — because it is.
 *
 * Switching basis means switching BOTH legs of the trailing chain. A
 * consolidated interim against an unconsolidated annual produces a number that
 * is neither, so a company only qualifies here when a consolidated annual AND
 * a consolidated interim pair both exist.
 *
 *   npx tsx scripts/detect-consolidated-basis.ts
 */
import { loadEnvLocal } from './load-env';
import { readFileSync } from 'node:fs';
loadEnvLocal();

type Row = { ticker: string; fiscal_year: number|null; fiscal_period: string|null; reporting_basis: string|null; data: Record<string,number|null>|null };

async function main(){
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const { activeUniverseTickers } = await import('@/lib/engine/universe');
  const db = createAdminClient();
  const store = JSON.parse(readFileSync('data/sarmaaya-snapshots.json','utf8')).snapshots as Record<string,{eps?:number}>;
  const live = new Set(await activeUniverseTickers(db,'companies'));

  const rows: Row[] = [];
  for(let o=0;;o+=1000){
    const {data}=await db.from('company_financials')
      .select('ticker,fiscal_year,fiscal_period,reporting_basis,data')
      .eq('statement_type','income_statement').eq('review_status','published').range(o,o+999);
    if(!data?.length)break; rows.push(...(data as Row[])); if(data.length<1000)break;
  }

  const byTicker = new Map<string,Row[]>();
  for(const r of rows){ if(!live.has(r.ticker))continue;
    if(!byTicker.has(r.ticker))byTicker.set(r.ticker,[]); byTicker.get(r.ticker)!.push(r); }

  const eps=(r:Row|undefined)=>{const v=r?.data?.eps;return typeof v==='number'&&Number.isFinite(v)?v:null;};
  const near=(a:number|null,b:number,p:number)=>a!==null&&b!==0&&Math.abs(a/b-1)<=p;

  const hits: {ticker:string;consol:number;uncon:number|null;theirs:number;period:string}[]=[];
  let bothBases=0;

  for(const [t,all] of byTicker){
    const theirs=store[t]?.eps; if(theirs==null)continue;
    const consol=all.filter(r=>r.reporting_basis==='consolidated');
    if(!consol.length)continue;
    bothBases++;

    // TTM on the consolidated series alone: annual + interim - prior interim.
    const cAnnuals=consol.filter(r=>r.fiscal_period==='FY').sort((a,b)=>(b.fiscal_year??0)-(a.fiscal_year??0));
    const aY=cAnnuals[0]?.fiscal_year??null;
    const aE=eps(cAnnuals[0]);
    let ttm:number|null=null, period='';
    if(aY!==null&&aE!==null){
      for(const lbl of ['9M','H1','Q1']){
        const cur=eps(consol.find(r=>r.fiscal_year===aY+1&&(r.fiscal_period??'').toUpperCase()===lbl));
        const pri=eps(consol.find(r=>r.fiscal_year===aY&&(r.fiscal_period??'').toUpperCase()===lbl));
        if(cur!==null&&pri!==null){ ttm=aE+cur-pri; period=`TTM to ${aY+1} ${lbl}`; break; }
      }
      // A consolidated interim with no prior-year leg still beats nothing when
      // the annual alone is what Sarmaaya appears to quote.
      if(ttm===null){ ttm=aE; period=`${aY} FY`; }
    } else {
      // No consolidated annual: the freshest consolidated cumulative, which can
      // still show whether the group basis is the one Sarmaaya is using.
      const cum=consol.filter(r=>['9M','H1'].includes((r.fiscal_period??'').toUpperCase()))
        .sort((a,b)=>(b.fiscal_year??0)-(a.fiscal_year??0));
      if(cum.length){ ttm=eps(cum[0]); period=`${cum[0].fiscal_year} ${cum[0].fiscal_period} (no consolidated annual)`; }
    }
    if(ttm===null)continue;

    // Our current unconsolidated answer, for contrast.
    const uAnnuals=all.filter(r=>r.fiscal_period==='FY'&&r.reporting_basis!=='consolidated')
      .sort((a,b)=>(b.fiscal_year??0)-(a.fiscal_year??0));
    const uncon=eps(uAnnuals[0]);

    if(near(ttm,theirs,0.10) && !near(uncon,theirs,0.10)) hits.push({ticker:t,consol:ttm,uncon,theirs,period});
  }

  console.log(`${bothBases} live companies hold consolidated rows`);
  console.log(`${hits.length} where the consolidated figure reconciles and the unconsolidated one does not\n`);
  console.log('ticker    consolidated  unconsolidated   sarmaaya   basis of consolidated figure');
  for(const h of hits.sort((a,b)=>a.ticker.localeCompare(b.ticker)))
    console.log(`${h.ticker.padEnd(9)} ${h.consol.toFixed(2).padStart(12)} ${String(h.uncon===null?'-':h.uncon.toFixed(2)).padStart(15)} ${String(h.theirs).padStart(10)}   ${h.period}`);
}
main().catch(e=>{console.error(e.message);process.exit(1)});
