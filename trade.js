/* NEXTBIT Spot — live Binance market data and secure internal execution. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const pair=$('tradePair'),chart=$('tradeChart');
  if(!pair||!chart)return;
  const priceNode=$('tradeLastPrice'),changeNode=$('tradePriceChange');
  const highNode=$('tradeDayHigh'),lowNode=$('tradeDayLow'),volumeNode=$('tradeDayVolume');
  const asksNode=$('tradeAsks'),bidsNode=$('tradeBids'),recentNode=$('tradeRecentRows');
  const midNode=$('tradeMidPrice'),interval=$('tradeInterval');
  const quantity=$('tradeQuantity'),limitPrice=$('tradeLimitPrice'),total=$('tradeTotal');
  const sideWrap=document.querySelector('#tradeView .trade-order-tabs');
  const sideButtons=[...document.querySelectorAll('#tradeView [data-side]')];
  const assetList=['BTC','ETH','SOL','BNB','XRP','DOGE','ADA','TRX','USDT'];
  const cryptoList=assetList.filter(a=>a!=='USDT');
  const fmtPrice=n=>Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:Number(n)<1?6:2});
  const fmtQty=n=>Number(n).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:8});
  const fmtMoney=n=>'$'+Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  let socket=null,retryTimer=null,retryDelay=1200,activeSymbol='',lastPrice=0,usdBalance=0,assetBalances={},client=null,currentUser=null;
  let orderBook={asks:[],bids:[]},recentTrades=[],mode='buy',busy=false,convertPriceCache={};
  const status=document.createElement('div');
  status.id='tradeExecutionStatus';
  status.setAttribute('role','status');
  status.style.cssText='display:none;margin-top:11px;padding:10px 12px;border:1px solid rgba(210,220,235,.18);border-radius:9px;background:rgba(255,255,255,.045);color:#dce3ed;font-size:11px;line-height:1.45;overflow-wrap:anywhere';
  const feeLine=document.createElement('div');
  feeLine.id='tradeFeePreview';
  feeLine.style.cssText='display:flex;justify-content:space-between;gap:10px;margin-top:10px;color:#aeb7c6;font-size:10px';
  feeLine.innerHTML='<span>Trading fee (0.1%)</span><strong id="tradeFeeValue" style="color:#e4e9f0;font-weight:700">—</strong>';
  const convertFields=document.createElement('div');
  convertFields.id='tradeConvertFields';
  convertFields.style.cssText='display:none;grid-template-columns:1fr 1fr;gap:9px;margin-top:12px';
  convertFields.innerHTML='<label style="display:block;color:#aeb7c6;font-size:10px">From<select id="tradeConvertFrom" class="trade-control" style="width:100%;margin-top:6px"></select></label><label style="display:block;color:#aeb7c6;font-size:10px">To<select id="tradeConvertTo" class="trade-control" style="width:100%;margin-top:6px"></select></label>';
  const style=document.createElement('style');
  style.textContent='#tradeView .trade-order-tabs{grid-template-columns:repeat(3,minmax(0,1fr))!important}#tradeView [data-side="convert"][aria-pressed="true"]{background:#292e36;border-color:#778391;color:#fff}#tradeConvertFields select{background:#0b0d10;color:#fff}#tradeExecutionStatus.success{border-color:rgba(53,201,120,.35);color:#75e2a9}#tradeExecutionStatus.error{border-color:rgba(237,116,125,.4);color:#ff9da4}';
  document.head.appendChild(style);
  if(sideWrap){
    const convertButton=document.createElement('button');
    convertButton.type='button';convertButton.dataset.side='convert';convertButton.setAttribute('aria-pressed','false');convertButton.textContent='Convert';
    sideWrap.appendChild(convertButton);
    sideButtons.push(convertButton);
    const orderType=document.querySelector('#tradeView .trade-type-tabs');
    if(orderType)orderType.style.display='none';
    sideWrap.insertAdjacentElement('afterend',convertFields);
    const available=document.querySelector('#tradeView .trade-available');
    if(available){available.insertAdjacentElement('afterend',feeLine);feeLine.insertAdjacentElement('afterend',status);}
  }
  const fromSelect=$('tradeConvertFrom'),toSelect=$('tradeConvertTo');
  if(fromSelect&&toSelect){
    assetList.forEach(a=>{const x=document.createElement('option');x.value=a;x.textContent=a;fromSelect.appendChild(x);});
    assetList.forEach(a=>{const x=document.createElement('option');x.value=a;x.textContent=a;toSelect.appendChild(x);});
    fromSelect.value='BTC';toSelect.value='ETH';
  }
  function selectedAsset(){return pair.options[pair.selectedIndex].text.split('/')[0].toUpperCase();}
  function selectedSide(){return mode;}
  function showStatus(message,type){
    status.textContent=message;status.className=type||'';status.style.display='block';
  }
  function hideStatus(){status.style.display='none';status.textContent='';status.className='';}
  function symbol(){return pair.value.split(':').pop().toLowerCase();}
  function updateChart(){
    const selected=pair.value,frame=interval?.value||'15';
    chart.src='https://www.tradingview.com/widgetembed/?symbol='+encodeURIComponent(selected)+'&interval='+encodeURIComponent(frame)+'&hidesidetoolbar=0&symboledit=0&saveimage=0&toolbarbg=%23080b10&theme=dark&style=1&timezone=Etc%2FUTC&withdateranges=1&hideideas=1&locale=en';
    chart.title='Live TradingView candlestick chart for '+pair.options[pair.selectedIndex].text;
    const heading=$('tradePairHeading');if(heading)heading.textContent=pair.options[pair.selectedIndex].text;
    updateTotal();updateAvailable();
  }
  function renderDepth(node,rows,kind){
    if(!node)return;
    if(!rows.length){node.innerHTML='<div class="trade-feed-empty">Waiting for market depth…</div>';return;}
    const max=Math.max(...rows.map(r=>r.total),0.00000001);
    node.innerHTML=rows.map(r=>'<div class="trade-depth-row '+kind+'"><i class="depth-bar" style="width:'+Math.max(2,r.total/max*100).toFixed(1)+'%;background:'+(kind==='ask'?'#e66c75':'#35c978')+'"></i><span class="price">'+fmtPrice(r.price)+'</span><span>'+fmtQty(r.amount)+'</span><span>'+fmtQty(r.total)+'</span></div>').join('');
  }
  function renderBook(data){
    const asks=(data.asks||[]).slice(0,8).reverse().map(([p,q])=>({price:Number(p),amount:Number(q),total:0}));
    const bids=(data.bids||[]).slice(0,8).map(([p,q])=>({price:Number(p),amount:Number(q),total:0}));
    [asks,bids].forEach(rows=>{let sum=0;rows.forEach(r=>{sum+=r.amount;r.total=sum;});});
    orderBook={asks,bids};renderDepth(asksNode,asks,'ask');renderDepth(bidsNode,bids,'bid');
    if(midNode&&lastPrice)midNode.textContent=fmtPrice(lastPrice);
  }
  function renderRecent(rows){
    if(!recentNode)return;
    recentNode.innerHTML=rows.slice(0,12).map(t=>{
      const price=Number(t.p),qty=Number(t.q),time=new Date(Number(t.T)).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
      const sell=Boolean(t.m);
      return '<div class="trade-depth-row"><span class="price" style="color:'+(sell?'#ed747d':'#35c978')+'">'+fmtPrice(price)+'</span><span>'+fmtQty(qty)+'</span><span>'+time+'</span></div>';
    }).join('')||'<div class="trade-feed-empty">No recent trades yet.</div>';
  }
  function getQuoteAssets(){
    if(mode==='buy')return {from:'USD',to:selectedAsset(),fromPrice:1,toPrice:lastPrice};
    if(mode==='sell')return {from:selectedAsset(),to:'USD',fromPrice:lastPrice,toPrice:1};
    return {from:fromSelect.value,to:toSelect.value};
  }
  async function fetchPrice(asset){
    if(asset==='USD'||asset==='USDT')return 1;
    const cached=convertPriceCache[asset];
    if(cached&&Date.now()-cached.at<4000)return cached.price;
    const response=await fetch('https://api.binance.com/api/v3/ticker/price?symbol='+asset+'USDT',{cache:'no-store'});
    if(!response.ok)throw new Error('Unable to load the '+asset+' price');
    const data=await response.json(),price=Number(data.price);
    if(!(price>0))throw new Error('The '+asset+' price is unavailable');
    convertPriceCache[asset]={price,at:Date.now()};return price;
  }
  async function updateTotal(){
    if(!total||!quantity)return;
    const amount=Number(quantity.value||0),feeNode=$('tradeFeeValue');
    let gross=0,fee=0,unit='';
    try{
      if(mode==='buy'){gross=amount;fee=gross*.001;unit=selectedAsset();total.value=amount>0&&lastPrice>0?(amount*lastPrice).toFixed(2):'';}
      else if(mode==='sell'){gross=amount*lastPrice;fee=gross*.001;unit='USD';total.value=amount>0&&lastPrice>0?gross.toFixed(2):'';}
      else{
        const from=fromSelect.value,to=toSelect.value;
        if(from===to){total.value='';if(feeNode)feeNode.textContent='Choose different assets';return;}
        const [fp,tp]=await Promise.all([fetchPrice(from),fetchPrice(to)]);
        gross=amount*fp/tp;fee=gross*.001;unit=to;total.value=amount>0?gross.toFixed(8):'';
      }
      if(feeNode)feeNode.textContent=amount>0&&gross>0?fmtQty(fee)+' '+unit:'—';
    }catch(e){total.value='';if(feeNode)feeNode.textContent='Price unavailable';}
  }
  function updateAvailable(){
    const label=$('tradeAvailableLabel'),node=$('tradeAvailableBalance'),submit=$('tradeSubmitButton');
    if(!label||!node)return;
    if(mode==='buy'){label.textContent='Available Main Wallet';node.textContent=fmtMoney(usdBalance);}
    else if(mode==='sell'){const asset=selectedAsset();label.textContent='Available '+asset;node.textContent=fmtQty(assetBalances[asset]||0)+' '+asset;}
    else{const asset=fromSelect?.value||'BTC';label.textContent='Available '+asset;node.textContent=fmtQty(assetBalances[asset]||0)+' '+asset;}
    if(submit)submit.textContent=mode==='buy'?'Buy '+selectedAsset():mode==='sell'?'Sell '+selectedAsset():'Convert';
    updateTotal();
  }
  function paintTicker(t){
    const price=Number(t.c),change=Number(t.P);
    if(!(price>0)||!Number.isFinite(change))return;
    lastPrice=price;
    if(priceNode)priceNode.textContent=fmtPrice(price);
    if(changeNode){changeNode.textContent=(change>0?'+':'')+change.toFixed(2)+'%';changeNode.style.color=change>=0?'#35c978':'#ed747d';}
    if(highNode)highNode.textContent=fmtPrice(t.h);
    if(lowNode)lowNode.textContent=fmtPrice(t.l);
    if(volumeNode)volumeNode.textContent=Number(t.q)>=1e9?'$'+(Number(t.q)/1e9).toFixed(2)+'B':Number(t.q)>=1e6?'$'+(Number(t.q)/1e6).toFixed(2)+'M':'$'+Number(t.q).toLocaleString('en-US',{maximumFractionDigits:0});
    if(midNode)midNode.textContent=fmtPrice(price);
    updateTotal();
    const submit=$('tradeSubmitButton');if(submit)submit.disabled=!currentUser||busy||!(lastPrice>0);
  }
  function connect(){
    if(retryTimer)clearTimeout(retryTimer);
    if(socket){socket.onclose=null;socket.close();}
    activeSymbol=symbol();
    const streams=activeSymbol+'@ticker/'+activeSymbol+'@depth20@100ms/'+activeSymbol+'@aggTrade';
    socket=new WebSocket('wss://stream.binance.com:9443/stream?streams='+streams);
    socket.onopen=()=>{retryDelay=1200;};
    socket.onmessage=event=>{
      try{const packet=JSON.parse(event.data),data=packet.data||packet,stream=String(packet.stream||'');
        if(stream.endsWith('@ticker'))paintTicker(data);
        else if(stream.includes('@depth'))renderBook(data);
        else if(stream.endsWith('@aggTrade')){recentTrades.unshift(data);recentTrades=recentTrades.slice(0,12);renderRecent(recentTrades);}
      }catch(error){console.warn('NEXTBIT spot feed message error:',error);}
    };
    socket.onerror=()=>{};
    socket.onclose=()=>{retryTimer=setTimeout(connect,retryDelay);retryDelay=Math.min(retryDelay*2,30000);};
  }
  async function loadBalances(){
    if(!window.supabase?.createClient)return;
    client=window.supabase.createClient('https://cubzhenuumvsogysmaeo.supabase.co','sb_publishable_RqrGL9aFCgyzZsU9sRCzcw_zb2lCZ7N');
    try{
      const {data:{user},error}=await client.auth.getUser();if(error||!user){currentUser=null;const b=$('tradeSubmitButton');if(b)b.disabled=true;updateAvailable();return;}
      currentUser=user;
      const [cash,coins]=await Promise.all([
        client.from('nexbit_account_balances').select('balance').eq('user_id',user.id).maybeSingle(),
        client.from('nexbit_account_asset_balances').select('asset_code,balance').eq('user_id',user.id)
      ]);
      if(!cash.error)usdBalance=Number(cash.data?.balance||0);
      if(!coins.error){assetBalances={};(coins.data||[]).forEach(row=>{assetBalances[String(row.asset_code||'').toUpperCase()]=Number(row.balance||0);});}
      updateAvailable();
      const b=$('tradeSubmitButton');if(b)b.disabled=!(lastPrice>0)||busy;
    }catch(error){console.warn('NEXTBIT spot balance load failed:',error);}
  }
  async function executeTrade(){
    const submit=$('tradeSubmitButton');
    if(busy||!client||!currentUser){showStatus('Please sign in to continue.','error');return;}
    const amount=Number(quantity?.value||0);
    if(!(amount>0)||!Number.isFinite(amount)){showStatus('Enter a valid amount.','error');return;}
    if(mode!=='convert'&&!(lastPrice>0)){showStatus('Waiting for a live market price.','error');return;}
    const assets=getQuoteAssets();
    if(mode==='convert'&&assets.from===assets.to){showStatus('Choose two different assets.','error');return;}
    busy=true;if(submit){submit.disabled=true;submit.textContent='Processing…';}
    hideStatus();
    try{
      const idempotencyKey=crypto.randomUUID();
      const body={action:mode,fromAsset:assets.from,toAsset:assets.to,amount,idempotencyKey};
      const {data,error}=await client.functions.invoke('nexbit-spot-execute',{body});
      if(error)throw new Error(data?.error||error.message||'Execution failed');
      if(data?.error||data?.success!==true)throw new Error(data?.error||'Execution failed');
      showStatus('Completed · '+data.reference+' · Fee: '+fmtQty(data.feeAmount)+' '+data.feeAsset+' · Received: '+fmtQty(data.netOutput)+' '+data.toAsset,'success');
      quantity.value='';await loadBalances();
    }catch(error){showStatus(error.message||'Trade could not be completed.','error');}
    finally{busy=false;updateAvailable();if(submit)submit.disabled=!currentUser||!(lastPrice>0);}
  }
  pair.addEventListener('change',()=>{recentTrades=[];renderRecent(recentTrades);connect();updateChart();hideStatus();});
  interval?.addEventListener('change',updateChart);
  quantity?.addEventListener('input',updateTotal);
  limitPrice?.addEventListener('input',updateTotal);
  sideButtons.forEach(button=>button.addEventListener('click',()=>{
    mode=button.dataset.side;
    sideButtons.forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
    if(convertFields)convertFields.style.display=mode==='convert'?'grid':'none';
    if(quantity){quantity.placeholder=mode==='convert'?'Enter source amount':'Enter amount';}
    const asset=mode==='convert'?fromSelect.value:selectedAsset();
    const quantityLabel=document.querySelector('label[for="tradeQuantity"]');
    if(quantityLabel)quantityLabel.textContent='Amount ('+asset+')';
    const totalLabel=document.querySelector('label[for="tradeTotal"]');
    if(totalLabel)totalLabel.textContent=mode==='convert'?'Estimated Receive ('+(toSelect.value)+')':'Estimated Total (USDT)';
    hideStatus();updateAvailable();
  }));
  fromSelect?.addEventListener('change',()=>{const label=document.querySelector('label[for="tradeQuantity"]');if(label)label.textContent='Amount ('+fromSelect.value+')';updateAvailable();});
  toSelect?.addEventListener('change',()=>{const label=document.querySelector('label[for="tradeTotal"]');if(label)label.textContent='Estimated Receive ('+toSelect.value+')';updateTotal();});
  $('tradeSubmitButton')?.addEventListener('click',executeTrade);
  document.querySelectorAll('[data-trade-data-tab]').forEach(button=>button.addEventListener('click',()=>{
    const recent=button.dataset.tradeDataTab==='recent';
    document.querySelectorAll('[data-trade-data-tab]').forEach(tab=>{const active=tab===button;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));});
    $('tradeDepthPanel').hidden=recent;$('tradeRecentPanel').hidden=!recent;
  }));
  updateChart();connect();loadBalances();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&(!socket||socket.readyState===WebSocket.CLOSED))connect();});
  window.addEventListener('beforeunload',()=>{if(retryTimer)clearTimeout(retryTimer);if(socket)socket.close();});
})();