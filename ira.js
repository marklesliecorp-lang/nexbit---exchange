/* NEXTBIT IRA account management and projected-balance calculator */
(function(){
 'use strict';
 const root=document.getElementById('iraView');if(!root)return;
 const buttons=[...root.querySelectorAll('[data-ira-section]')];
 const sections={overview:root.querySelector('#ira-overview-section'),active:root.querySelector('#ira-active-section'),growth:root.querySelector('#ira-growth-section'),core:root.querySelector('#ira-core-section')};
 function show(name){const key=Object.prototype.hasOwnProperty.call(sections,name)?name:'overview';Object.entries(sections).forEach(([k,node])=>{if(node)node.hidden=k!==key;});buttons.forEach(b=>{const on=b.dataset.iraSection===key;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});}
 buttons.forEach(b=>b.addEventListener('click',()=>show(b.dataset.iraSection)));
 const money=n=>'$'+Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const dateFmt=value=>value?new Date(value+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—';
 function calc(key){
  const growth=key==='growth',prefix=growth?'iraGrowth':'iraCore',rate=growth?.25:.15,min=growth?500:200;
  const select=root.querySelector('#'+prefix+'Amount'),custom=root.querySelector('#'+prefix+'Custom'),duration=root.querySelector('#'+prefix+'Duration');
  const contribution=root.querySelector('#'+prefix+'Contributions'),interest=root.querySelector('#'+prefix+'Interest'),balance=root.querySelector('#'+prefix+'Balance');
  const amount=select.value==='custom'?Number(custom.value):Number(select.value),months=Number(duration.value)*12;
  if(!Number.isFinite(amount)||amount<min){contribution.textContent=money(0);interest.textContent=money(0);balance.textContent=money(0);return;}
  const total=amount*months,projected=amount*(1+rate)*((Math.pow(1+rate,months)-1)/rate);
  contribution.textContent=money(total);interest.textContent=money(projected-total);balance.textContent=money(projected);
 }
 ['growth','core'].forEach(key=>{
  const prefix=key==='growth'?'iraGrowth':'iraCore',select=root.querySelector('#'+prefix+'Amount'),custom=root.querySelector('#'+prefix+'Custom'),duration=root.querySelector('#'+prefix+'Duration');
  select.addEventListener('change',()=>{custom.hidden=select.value!=='custom';calc(key);});
  custom.addEventListener('input',()=>calc(key));duration.addEventListener('change',()=>calc(key));calc(key);
 });
 const modal=root.querySelector('#iraReviewModal'),details=root.querySelector('#iraReviewDetails');
 const enrollMessage=root.querySelector('#iraEnrollMessage'),enrollButton=root.querySelector('#iraEnrollConfirm');
 const client=window.supabase?.createClient?window.supabase.createClient('https://cubzhenuumvsogysmaeo.supabase.co','sb_publishable_RqrGL9aFCgyzZsU9sRCzcw_zb2lCZ7N'):null;
 let selected=null,enrolling=false;
 async function loadIraAccounts(){
  const host=root.querySelector('#iraActivePlans');if(!host)return;
  if(!client){host.innerHTML='<div class="ira-empty"><strong>Secure connection unavailable</strong><p>Please refresh and try again.</p></div>';return;}
  const {data:{user},error:userError}=await client.auth.getUser();
  if(userError||!user){host.innerHTML='<div class="ira-empty"><strong>Please sign in again</strong></div>';return;}
  const {data:accounts,error}=await client.from('nexbit_ira_accounts').select('id,reference,plan_code,monthly_contribution,monthly_rate_percent,duration_years,status,first_contribution_month,maturity_date,current_balance,total_contributions,total_interest').eq('user_id',user.id).order('created_at',{ascending:false}).limit(100);
  if(error){console.error('IRA account load failed:',error);host.innerHTML='<div class="ira-empty"><strong>IRA records unavailable</strong><p>Please refresh to try again.</p></div>';return;}
  const ids=(accounts||[]).map(a=>a.id);let contributionMap={};
  if(ids.length){const {data:contributions,error:contributionError}=await client.from('nexbit_ira_contributions').select('account_id,period_month,amount,status').in('account_id',ids).order('period_month',{ascending:false}).limit(500);if(!contributionError)(contributions||[]).forEach(c=>(contributionMap[c.account_id]??=[]).push(c));}
  if(!accounts?.length){host.innerHTML='<div class="ira-empty"><span>◇</span><strong>No active IRA plan yet</strong><p>Your enrolled plans and account activity will appear here.</p></div>';return;}
  host.innerHTML=accounts.map(a=>{
   const history=(contributionMap[a.id]||[]).slice(0,6).map(c=>'<div><span>'+dateFmt(c.period_month)+'</span><b class="'+(c.status==='paid'?'paid':'missed')+'">'+(c.status==='paid'?'Paid':'Missed')+'</b><span>'+money(c.amount)+'</span></div>').join('')||'<p>No contribution records yet.</p>';
   const reopen=a.status==='locked'?'<p class="ira-account-alert">This plan is locked after missed contributions. Reopening requires outstanding contributions and the $50 fee.</p><button type="button" class="ira-review-button ira-reopen-button" data-ira-reopen="'+safe(a.id)+'">Reopen IRA</button>':'';
   return '<article class="ira-account-card"><div class="ira-account-top"><div><span class="ira-eyebrow">'+(a.plan_code==='growth'?'IRA GROWTH':'IRA CORE')+'</span><strong>'+safe(a.reference)+'</strong></div><span class="ira-status '+safe(a.status)+'">'+safe(a.status.toUpperCase())+'</span></div><div class="ira-account-balance"><span>Current IRA balance</span><strong>'+money(a.current_balance)+'</strong></div><div class="ira-account-grid"><div><span>Monthly contribution</span><strong>'+money(a.monthly_contribution)+'</strong></div><div><span>Monthly rate</span><strong>'+Number(a.monthly_rate_percent)+'%</strong></div><div><span>Total contributed</span><strong>'+money(a.total_contributions)+'</strong></div><div><span>Interest credited</span><strong>'+money(a.total_interest)+'</strong></div><div><span>First contribution</span><strong>'+dateFmt(a.first_contribution_month)+'</strong></div><div><span>Maturity date</span><strong>'+dateFmt(a.maturity_date)+'</strong></div></div>'+reopen+'<div class="ira-contribution-history"><strong>Contribution history</strong>'+history+'</div></article>';
  }).join('');
 }
 let selectedPlan=null;
 root.querySelectorAll('[data-ira-review]').forEach(btn=>btn.addEventListener('click',()=>{
  const growth=btn.dataset.iraReview==='growth',key=growth?'growth':'core',prefix=growth?'iraGrowth':'iraCore',min=growth?500:200,rate=growth?.25:.15;
  const select=root.querySelector('#'+prefix+'Amount'),custom=root.querySelector('#'+prefix+'Custom'),duration=root.querySelector('#'+prefix+'Duration');
  const amount=select.value==='custom'?Number(custom.value):Number(select.value);
  if(!Number.isFinite(amount)||amount<min){alert('Enter a monthly contribution of at least $'+min.toLocaleString('en-US')+'.');return;}
  const months=Number(duration.value)*12,total=amount*months,projected=amount*(1+rate)*((Math.pow(1+rate,months)-1)/rate);
  const localDate=new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'}));
  const immediate=localDate.getDate()<=10;
  selectedPlan={plan:key,amount,durationYears:Number(duration.value)};
  details.innerHTML=[['Selected plan',growth?'IRA Growth':'IRA Core'],['Monthly contribution',money(amount)],['Monthly rate',(rate*100)+'%'],['Duration',months+' months'],['Total contributions',money(total)],['Projected interest',money(projected-total)],['Projected maturity balance',money(projected)],['First deduction',immediate?'Immediately':'Next month, between the 1st and 10th (Eastern Time)']].map(([label,value])=>'<div><span>'+label+'</span><strong>'+safe(value)+'</strong></div>').join('');
  enrollMessage.textContent='';enrollButton.disabled=false;enrollButton.textContent='Confirm Enrolment';modal.hidden=false;
 }));
 const close=()=>{if(enrolling)return;modal.hidden=true;selectedPlan=null;};
 root.querySelector('#iraReviewClose').addEventListener('click',close);root.querySelector('#iraReviewDone').addEventListener('click',close);
 modal.addEventListener('click',e=>{if(e.target===modal)close();});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modal.hidden)close();});
 enrollButton.addEventListener('click',async()=>{
  if(!selectedPlan||enrolling)return;
  if(!client){enrollMessage.textContent='Secure connection unavailable. Please refresh.';return;}
  enrolling=true;enrollButton.disabled=true;enrollButton.textContent='Processing…';enrollMessage.textContent='';
  try{
   const {data,error}=await client.rpc('nexbit_ira_enrol',{p_plan_code:selectedPlan.plan,p_monthly_contribution:selectedPlan.amount,p_duration_years:selectedPlan.durationYears,p_idempotency_key:crypto.randomUUID()});
   if(error)throw error;
   enrollMessage.textContent=data?.first_deduction_now?'IRA enrolled. Your first contribution has been deducted.':'IRA enrolled. Your first deduction is scheduled for the next collection window.';
   selectedPlan=null;await loadIraAccounts();setTimeout(()=>{modal.hidden=true;show('active');},900);
  }catch(error){console.error('IRA enrolment failed:',error);enrollMessage.textContent=error.message||'Enrolment could not be completed.';enrollButton.disabled=false;enrollButton.textContent='Try Again';}
  finally{enrolling=false;}
 });
 root.querySelector('#iraActivePlans')?.addEventListener('click',async e=>{
  const button=e.target.closest('[data-ira-reopen]');if(!button||!client||enrolling)return;
  if(!confirm('Reopen this IRA? The outstanding missed contributions plus the $50 reopening fee will be deducted from your available balance.'))return;
  enrolling=true;button.disabled=true;button.textContent='Reopening…';
  try{const {error}=await client.rpc('nexbit_ira_reopen',{p_account_id:button.dataset.iraReopen,p_idempotency_key:crypto.randomUUID()});if(error)throw error;await loadIraAccounts();alert('IRA reopened successfully.');}
  catch(error){alert(error.message||'IRA could not be reopened.');button.disabled=false;button.textContent='Reopen IRA';}
  finally{enrolling=false;}
 });
 loadIraAccounts();
 show('overview');
})();