/* NEXBIT Investment tabs: one controller for section and category navigation. */
(function(){
 'use strict';
 const root=document.getElementById('investmentView');if(!root)return;
 const sectionButtons=[...root.querySelectorAll('[data-investment-section]')];
 const sections={overview:root.querySelector('#investment-overview-section'),active:root.querySelector('#investment-active-plans'),packages:root.querySelector('#investment-packages')};
 const categoryButtons=[...root.querySelectorAll('[data-package-category]')];
 const categoryPanels=[...root.querySelectorAll('[data-package-panel]')];
 function showSection(name){
  const selected=Object.prototype.hasOwnProperty.call(sections,name)?name:'packages';
  Object.entries(sections).forEach(([key,node])=>{if(node)node.hidden=key!==selected;});
  sectionButtons.forEach(button=>{const active=button.dataset.investmentSection===selected;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
 }
 function showCategory(name){
  const selected=['crypto','stocks','options'].includes(name)?name:'stocks';
  categoryButtons.forEach(button=>{const active=button.dataset.packageCategory===selected;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});
  categoryPanels.forEach(panel=>{panel.hidden=panel.dataset.packagePanel!==selected;});
 }
 sectionButtons.forEach(button=>button.addEventListener('click',()=>showSection(button.dataset.investmentSection)));
 categoryButtons.forEach(button=>button.addEventListener('click',()=>showCategory(button.dataset.packageCategory)));
 showSection('packages');showCategory('stocks');
 window.NEXBIT_SHOW_INVESTMENT_SECTION=showSection;
})();