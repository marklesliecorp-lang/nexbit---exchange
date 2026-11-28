(function(){
 'use strict';
 const supabase=window.supabase;
 const client=supabase?.createClient?.('https://cubzhenuumvsogysmaeo.supabase.co','sb_publishable_RqrGL9aFCgyzZsU9sRCzcw_zb2lCZ7N');
 const $=id=>document.getElementById(id);
 const adminEmail='markleslie.corp@gmail.com';
 let ready=false;
 async function authorized(){
  if(!client)return false;
  const {data:{user},error}=await client.auth.getUser();
  return !error&&!!user&&(user.email||'').toLowerCase()===adminEmail&&user.app_metadata?.role==='admin';
 }
 async function load(){
  if(!await authorized()){ $('iraPlanMessage').textContent='Administrator access required.';return; }
  $('iraPlanMessage').textContent='Loading current plan settings…';
  const {data,error}=await client.rpc('admin_ira_get_plan_settings');
  if(error)throw error;
  (data||[]).forEach(p=>{
   const key=p.plan_code==='growth'?'Growth':'Core';
   $('ira'+key+'Minimum').value=p.minimum_monthly_contribution;
   $('ira'+key+'Rate').value=p.monthly_rate_percent;
   $('ira'+key+'Enabled').checked=!!p.enabled;
  });
  ready=true;$('iraPlanMessage').textContent='Settings loaded. Updates affect new enrolments only.';
 }
 async function save(plan,button){
  if(!ready)return;
  const key=plan==='growth'?'Growth':'Core';
  const minimum=Number($('ira'+key+'Minimum').value),rate=Number($('ira'+key+'Rate').value),enabled=$('ira'+key+'Enabled').checked;
  if(!Number.isFinite(minimum)||minimum<=0||!Number.isFinite(rate)||rate<0||rate>100){
   $('iraPlanMessage').textContent='Enter a minimum greater than zero and a monthly rate between 0 and 100.';return;
  }
  if(!confirm('Save '+key+' IRA settings? This will affect new enrolments only. Existing accounts will not change.'))return;
  button.disabled=true;$('iraPlanMessage').textContent='Saving '+key+' settings…';
  try{
   const {data,error}=await client.rpc('admin_ira_update_plan_settings',{p_plan_code:plan,p_minimum_monthly_contribution:minimum,p_monthly_rate_percent:rate,p_enabled:enabled});
   if(error)throw error;
   $('iraPlanMessage').textContent=key+' settings saved. New enrolments will use '+Number(data.minimum_monthly_contribution).toLocaleString()+' USDT minimum and '+data.monthly_rate_percent+'% monthly rate.';
  }catch(error){$('iraPlanMessage').textContent=error.message||'Could not save IRA settings.';}
  finally{button.disabled=false;}
 }
 window.loadAdminIraPlans=()=>load().catch(e=>{$('iraPlanMessage').textContent=e.message||'Could not load IRA plan settings.';});
 document.querySelectorAll('[data-save-ira-plan]').forEach(b=>b.addEventListener('click',()=>save(b.dataset.saveIraPlan,b)));
 $('refreshIraPlans')?.addEventListener('click',window.loadAdminIraPlans);
})();