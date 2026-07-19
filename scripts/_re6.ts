import { loadEnvLocal } from './load-env';
loadEnvLocal();
process.env.VISION_DISABLED='false'; process.env.AI_DISABLED='false';
import { readFileSync } from 'node:fs';
async function main(){
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const { extractFinancials } = await import('@/lib/engine/financials');
  const { refreshRatios } = await import('@/lib/engine/ratios');
  const db=createAdminClient();
  const store=JSON.parse(readFileSync('data/sarmaaya-snapshots.json','utf8')).snapshots;
  for(const t of ['AVN','SIEM','PSEL','SEARL','GAL','HUMNL']){
    // clear filing-sourced income rows so the corrected prompt writes fresh ones
    await db.from('company_financials').update({review_status:'needs_review',validation_flags:['superseded_by_reextract']})
      .eq('ticker',t).eq('source_type','psx-filing').eq('review_status','published');
    const r=await extractFinancials(t,4,true);
    await refreshRatios(db,t);
    const {data}=await db.from('company_ratios').select('ratio_value,inputs,source_period').eq('ticker',t).eq('ratio_name','P/E').maybeSingle();
    const ours=(data?.inputs as any)?.eps??null, theirs=store[t]?.eps??null;
    const d=(ours!=null&&theirs)?((ours/theirs-1)*100).toFixed(0)+'%':'-';
    console.log(`${t.padEnd(7)} ours=${String(ours==null?'-':ours.toFixed(2)).padStart(8)} sarmaaya=${String(theirs??'-').padStart(8)}  ${String(d).padStart(7)}  ${data?.source_period??''}  (saved ${r.saved})`);
  }
}
main().catch(e=>{console.error(e.message);process.exit(1)});
