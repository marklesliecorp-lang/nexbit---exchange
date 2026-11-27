/* NEXTBIT IRA navigation and projected-balance calculator */
(function(){
 'use strict';
 const root=document.getElementById('iraView');if(!root)return;
 const buttons=[...root.querySelectorAll('[data-ira-section]')];
 const sections={overview:root.querySelector('#ira-overview-section'),active:root.querySelector('#ira-active-section'),growth:root.querySelector('#ira-growth-section'),core:root.querySelector('#ira-core-section')};
 function show(name){const key=Object.prototype.hasOwnProperty.call(sections,name)?name:'overview';Object.entries(sections).forEach(([k,node])=>{if(node)node.hidden=k!==key;});buttons.forEach(b=>{const on=b.dataset.iraSection===key;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});}
 buttons.forEach(b=>b.addEventListener('click',()=>show(b.dataset.iraSection)));
 const money=n=>'$'+Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
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
 root.querySelectorAll('[data-ira-review]').forEach(btn=>btn.addEventListener('click',()=>{
  const growth=btn.dataset.iraReview==='growth',key=growth?'growth':'core',prefix=growth?'iraGrowth':'iraCore',min=growth?500:200,rate=growth?.25:.15;
  const select=root.querySelector('#'+prefix+'Amount'),custom=root.querySelector('#'+prefix+'Custom'),duration=root.querySelector('#'+prefix+'Duration');
  const amount=select.value==='custom'?Number(custom.value):Number(select.value);
  if(!Number.isFinite(amount)||amount<min){alert('Enter a monthly contribution of at least $'+min.toLocaleString('en-US')+'.');return;}
  const months=Number(duration.value)*12,total=amount*months,projected=amount*(1+rate)*((Math.pow(1+rate,months)-1)/rate);
  details.innerHTML=[['Selected plan',growth?'IRA Growth':'IRA Core'],['Monthly contribution',money(amount)],['Monthly rate',(rate*100)+'%'],['Duration',months+' months'],['Total contributions',money(total)],['Projected interest',money(projected-total)],['Projected maturity balance',money(projected)]].map(([label,value])=>'<div><span>'+label+'</span><strong>'+value+'</strong></div>').join('');
  modal.hidden=false;
 }));
 const close=()=>modal.hidden=true;
 root.querySelector('#iraReviewClose').addEventListener('click',close);root.querySelector('#iraReviewDone').addEventListener('click',close);
 modal.addEventListener('click',e=>{if(e.target===modal)close();});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modal.hidden)close();});
 show('overview');
})();