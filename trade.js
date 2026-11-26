/* NEXTBIT Spot market data — Binance public streams; read-only market feed. */
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
  const sideButtons=[...document.querySelectorAll('#tradeView [data-side]')];
  const fmtPrice=n=>Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:Number(n)<1?6:2});
  const fmtQty=n=>Number(n).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:6});
  const fmtMoney=n=>'$'+Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  let socket=null,retryTimer=null,retryDelay=1200,activeSymbol='',lastPrice=0,usdBalance=0,assetBalances={};
  let orderBook={asks:[],bids:[]};
  function symbol(){return pair.value.split(':').pop().toLowerCase();}
  function updateChart(){
    const selected=pair.value,frame=interval?.value||'15';
    chart.src='https://www.tradingview.com/widgetembed/?symbol='+encodeURIComponent(selected)+'&interval='+encodeURIComponent(frame)+'&hidesidetoolbar=0&symboledit=0&saveimage=0&toolbarbg=%23080b10&theme=dark&style=1&timezone=Etc%2FUTC&withdateranges=1&hideideas=1&locale=en';
    chart.title='Live TradingView candlestick chart for '+pair.options[pair.selectedIndex].text;
    const heading=$('tradePairHeading');if(heading)heading.textContent=pair.options[pair.selectedIndex].text;
    const submit=$('tradeSubmitButton');if(submit)submit.textContent=(sideButtons.find(b=>b.getAttribute('aria-pressed')==='true')?.dataset.side==='sell'?'Sell ':'Buy ')+pair.options[pair.selectedIndex].text.split('/')[0];
    updateTotal();
    updateAvailable();
  }
  function renderDepth(node,rows,kind){
    if(!node)return;
    if(!rows.length){node.innerHTML='<div class="trade-feed-empty">Waiting for market depth…</div>';return;}
    const max= Math.max(...rows.map(r=>r.total),0.00000001);
    node.innerHTML=rows.map(r=>'<div class="trade-depth-row '+kind+'"><i class="depth-bar" style="width:'+Math.max(2,r.total/max*100).toFixed(1)+'%;background:'+(kind==='ask'?'#e66c75':'#35c978')+'"></i><span class="price">'+fmtPrice(r.price)+'</span><span>'+fmtQty(r.amount)+'</span><span>'+fmtQty(r.total)+'</span></div>').join('');
  }
  function renderBook(data){
    const asks=(data.asks||[]).slice(0,8).reverse().map(([p,q])=>({price:Number(p),amount:Number(q),total:0}));
    const bids=(data.bids||[]).slice(0,8).map(([p,q])=>({price:Number(p),amount:Number(q),total:0}));
    [asks,bids].forEach(rows=>{let sum=0;rows.forEach(r=>{sum+=r.amount;r.total=sum;});});
    orderBook={asks,bids};
    renderDepth(asksNode,asks,'ask');renderDepth(bidsNode,bids,'bid');
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
  let recentTrades=[];
  function updateTotal(){
    if(!total||!quantity)return;
    const qty=Number(quantity.value||0),price=sideButtons.some(b=>b.dataset.side==='sell'&&b.getAttribute('aria-pressed')==='true')?lastPrice:lastPrice;
    const executionPrice=($('tradePriceField')&&!$('tradePriceField').hidden)?Number(limitPrice?.value||0):price;
    total.value=qty>0&&executionPrice>0?(qty*executionPrice).toFixed(2):'';
  }
  function updateAvailable(){
    const label=$('tradeAvailableLabel'),node=$('tradeAvailableBalance');
    if(!label||!node)return;
    const selling=sideButtons.some(b=>b.dataset.side==='sell'&&b.getAttribute('aria-pressed')==='true');
    const asset=pair.options[pair.selectedIndex].text.split('/')[0];
    label.textContent=selling?'Available '+asset:'Available USDT';
    node.textContent=selling?fmtQty(assetBalances[asset]||0)+' '+asset:fmtMoney(usdBalance);
    const submit=$('tradeSubmitButton');
    if(submit)submit.textContent=(selling?'Sell ':'Buy ')+asset;
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
  }
  function connect(){
    if(retryTimer)clearTimeout(retryTimer);
    if(socket){socket.onclose=null;socket.close();}
    activeSymbol=symbol();
    const streams=activeSymbol+'@ticker/'+activeSymbol+'@depth20@100ms/'+activeSymbol+'@aggTrade';
    socket=new WebSocket('wss://stream.binance.com:9443/stream?streams='+streams);
    socket.onopen=()=>{retryDelay=1200;};
    socket.onmessage=event=>{
      try{
        const packet=JSON.parse(event.data),data=packet.data||packet,stream=String(packet.stream||'');
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
    const client=window.supabase.createClient('https://cubzhenuumvsogysmaeo.supabase.co','sb_publishable_RqrGL9aFCgyzZsU9sRCzcw_zb2lCZ7N');
    try{
      const {data:{user},error}=await client.auth.getUser();if(error||!user)return;
      const [cash,coins]=await Promise.all([
        client.from('nexbit_account_balances').select('balance').eq('user_id',user.id).maybeSingle(),
        client.from('nexbit_account_asset_balances').select('asset_code,balance').eq('user_id',user.id)
      ]);
      if(!cash.error)usdBalance=Number(cash.data?.balance||0);
      if(!coins.error)(coins.data||[]).forEach(row=>{assetBalances[String(row.asset_code||'').toUpperCase()]=Number(row.balance||0);});
      updateAvailable();
    }catch(error){console.warn('NEXTBIT spot balance preview unavailable:',error);}
  }
  pair.addEventListener('change',()=>{recentTrades=[];renderRecent(recentTrades);connect();updateChart();});
  interval?.addEventListener('change',updateChart);
  quantity?.addEventListener('input',updateTotal);
  limitPrice?.addEventListener('input',updateTotal);
  sideButtons.forEach(button=>button.addEventListener('click',()=>{setTimeout(()=>{updateAvailable();updateTotal();},0);}));
  document.querySelectorAll('[data-trade-data-tab]').forEach(button=>button.addEventListener('click',()=>{
    const recent=button.dataset.tradeDataTab==='recent';
    document.querySelectorAll('[data-trade-data-tab]').forEach(tab=>{const active=tab===button;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));});
    $('tradeDepthPanel').hidden=recent;$('tradeRecentPanel').hidden=!recent;
  }));
  updateChart();connect();loadBalances();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&(!socket||socket.readyState===WebSocket.CLOSED))connect();});
  window.addEventListener('beforeunload',()=>{if(retryTimer)clearTimeout(retryTimer);if(socket)socket.close();});
})();