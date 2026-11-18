
// Coin logos used when the live-price provider does not return image URLs.
const NEXBIT_COIN_LOGOS = {
  BTC: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
  ETH: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
  SOL: "https://assets.coingecko.com/coins/images/4128/large/solana.png",
  BNB: "https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png",
  XRP: "https://assets.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png",
  DOGE: "https://assets.coingecko.com/coins/images/5/large/dogecoin.png"
};

document.addEventListener("DOMContentLoaded", () => {

  // =====================================
  // NEXBIT MARKET TABLE
  // =====================================

  const demoNote = document.querySelector(".demo-note");

  const sampleMarkets = [
    { name: "Bitcoin", symbol: "BTC", image: NEXBIT_COIN_LOGOS.BTC, price: 97450.25, change: 2.45 },
    { name: "Ethereum", symbol: "ETH", image: NEXBIT_COIN_LOGOS.ETH, price: 3240.80, change: 1.82 },
    { name: "Solana", symbol: "SOL", image: NEXBIT_COIN_LOGOS.SOL, price: 185.60, change: 4.25 },
    { name: "BNB", symbol: "BNB", image: NEXBIT_COIN_LOGOS.BNB, price: 645.30, change: -0.75 },
    { name: "XRP", symbol: "XRP", image: NEXBIT_COIN_LOGOS.XRP, price: 0, change: 0 },
    { name: "Dogecoin", symbol: "DOGE", image: NEXBIT_COIN_LOGOS.DOGE, price: 0, change: 0 }
  ];

  function displayMarkets(markets) {
    const marketList = document.getElementById("market-list");
    if (!marketList) return;

    const tags = { BTC: "TRENDING", ETH: "POPULAR", SOL: "HOT", BNB: "MARKET PICK" };
    marketList.innerHTML = "";

    markets.forEach(coin => {
      const symbol = String(coin.symbol || "").toUpperCase();
      const card = document.createElement("article");
      card.className = "market-card";
      card.dataset.symbol = symbol;

      const top = document.createElement("div");
      top.className = "market-card-top";

      const asset = document.createElement("div");
      asset.className = "market-card-asset";

      const logo = document.createElement("img");
      logo.className = "market-coin-logo";
      logo.src = coin.image || NEXBIT_COIN_LOGOS[symbol] || "";
      logo.alt = (coin.name || symbol) + " logo";
      logo.onerror = () => { logo.style.visibility = "hidden"; };

      const identity = document.createElement("div");
      const name = document.createElement("strong");
      name.className = "market-coin-name";
      name.textContent = coin.name || symbol;
      const ticker = document.createElement("span");
      ticker.className = "market-coin-symbol";
      ticker.textContent = symbol + " / USDT";
      identity.append(name, ticker);
      asset.append(logo, identity);

      const tag = document.createElement("span");
      tag.className = "market-card-tag";
      tag.textContent = tags[symbol] || "LIVE ASSET";
      top.append(asset, tag);

      const priceLine = document.createElement("div");
      priceLine.className = "market-card-price-line";
      const price = document.createElement("strong");
      price.className = "market-card-price";
      price.dataset.price = "true";
      price.textContent = "$" + Number(coin.price).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 8
      });

      const change = document.createElement("span");
      const changeValue = Number(coin.change) || 0;
      change.className = "market-change " + (changeValue >= 0 ? "up" : "down");
      change.dataset.change = "true";
      change.textContent = (changeValue >= 0 ? "▲ +" : "▼ ") + changeValue.toFixed(2) + "%";
      priceLine.append(price, change);

      const bottom = document.createElement("div");
      bottom.className = "market-card-bottom";
      const live = document.createElement("span");
      live.className = "market-live-dot";
      live.textContent = "LIVE MARKET DATA";
      bottom.append(live);

      card.append(top, priceLine, bottom);
      marketList.appendChild(card);
    });
  }

  // Binance's public WebSocket streams keep card prices moving continuously.
  function initializeNexbitLivePrices() {
    const symbols = ["btcusdt", "ethusdt", "solusdt", "bnbusdt", "xrpusdt", "dogeusdt"];
    const streams = symbols.map(symbol => symbol + "@ticker").join("/");
    const socketUrl = "wss://stream.binance.com:9443/stream?streams=" + streams;
    let fallbackTimer = null;
    let socket;

    function updateCard(ticker) {
      const symbol = String(ticker.s || "").replace("USDT", "");
      const card = document.querySelector('.market-card[data-symbol="' + symbol + '"]');
      if (!card) return;

      const priceNode = card.querySelector("[data-price]");
      const changeNode = card.querySelector("[data-change]");
      const price = Number(ticker.c);
      const change = Number(ticker.P);

      if (priceNode && Number.isFinite(price)) {
        priceNode.textContent = "$" + price.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 8
        });
      }

      if (changeNode && Number.isFinite(change)) {
        changeNode.classList.toggle("up", change >= 0);
        changeNode.classList.toggle("down", change < 0);
        changeNode.textContent = (change >= 0 ? "▲ +" : "▼ ") + change.toFixed(2) + "%";
      }
    }

    async function pollBackupPrices() {
      try {
        const pairs = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
        const url = "https://api.binance.com/api/v3/ticker/24hr?symbols=" +
          encodeURIComponent(JSON.stringify(pairs));
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error("Backup live prices unavailable");
        const data = await response.json();
        data.forEach(coin => updateCard({
          s: coin.symbol,
          c: coin.lastPrice,
          P: coin.priceChangePercent
        }));
      } catch (error) {
        console.warn("NEXBIT live-price backup is temporarily unavailable:", error);
      }
    }

    function connect() {
      try {
        socket = new WebSocket(socketUrl);
        socket.onopen = () => {
          if (fallbackTimer) {
            clearInterval(fallbackTimer);
            fallbackTimer = null;
          }
        };
        socket.onmessage = event => {
          try {
            const message = JSON.parse(event.data);
            if (message && message.data) updateCard(message.data);
          } catch (error) {
            console.warn("NEXBIT live market message could not be read:", error);
          }
        };
        socket.onerror = () => socket.close();
        socket.onclose = () => {
          if (!fallbackTimer) {
            pollBackupPrices();
            fallbackTimer = setInterval(pollBackupPrices, 15000);
          }
          setTimeout(connect, 5000);
        };
      } catch (error) {
        if (!fallbackTimer) fallbackTimer = setInterval(pollBackupPrices, 15000);
        setTimeout(connect, 5000);
      }
    }

    connect();
  }

  initializeNexbitLivePrices();

  async function loadMarkets() {
    if (demoNote) {
      demoNote.textContent = "Loading cryptocurrency prices...";
    }

    try {
      const url =
        "https://api.coingecko.com/api/v3/coins/markets" +
        "?vs_currency=usd" +
        "&ids=bitcoin,ethereum,solana,binancecoin,ripple,dogecoin" +
        "&price_change_percentage=24h&sparkline=true";

      const response = await fetch(url, { signal: AbortSignal.timeout(12000) });

      if (!response.ok) {
        throw new Error("Market data request failed");
      }

      const data = await response.json();

      if (!Array.isArray(data) || !data.length) {
        throw new Error("No market data received");
      }

      const markets = data.map(coin => ({
        name: coin.name,
        symbol: coin.symbol.toUpperCase(),
        price: coin.current_price,
        change: coin.price_change_percentage_24h || 0,
        image: coin.image,
        marketCap: coin.market_cap,
        sparkline: coin.sparkline_in_7d?.price || []
      }));

      displayMarkets(markets);

      if (demoNote) {
        demoNote.textContent =
          "Indicative market prices supplied by CoinGecko. Not executable trading quotes.";
      }

    } catch (error) {
      console.error("NEXBIT CoinGecko market data error:", error);

      try {
        const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
        const backupUrl =
          "https://api.binance.com/api/v3/ticker/24hr?symbols=" +
          encodeURIComponent(JSON.stringify(symbols));
        const backupResponse = await fetch(backupUrl, { signal: AbortSignal.timeout(12000) });

        if (!backupResponse.ok) {
          throw new Error("Backup market data request failed");
        }

        const backupData = await backupResponse.json();
        const names = {
          BTC: "Bitcoin",
          ETH: "Ethereum",
          SOL: "Solana",
          BNB: "BNB",
          XRP: "XRP",
          DOGE: "Dogecoin"
        };

        const backupMarkets = backupData.map(coin => ({
          name: names[coin.symbol.replace("USDT", "")] || coin.symbol,
          symbol: coin.symbol.replace("USDT", ""),
          image: NEXBIT_COIN_LOGOS[coin.symbol.replace("USDT", "")],
          price: Number(coin.lastPrice),
          change: Number(coin.priceChangePercent),
          marketCap: null,
          sparkline: []
        }));

        if (!backupMarkets.length) {
          throw new Error("No backup market data received");
        }

        displayMarkets(backupMarkets);
        if (demoNote) {
          demoNote.textContent =
            "Indicative prices supplied by Binance. Not executable trading quotes.";
        }
      } catch (backupError) {
        console.error("NEXBIT backup market data error:", backupError);
        displayMarkets(sampleMarkets);
        if (demoNote) {
          demoNote.textContent =
            "Live prices are temporarily unavailable. Showing demonstration prices instead.";
        }
      }
    }
  }

  loadMarkets();
  setInterval(loadMarkets, 60000);


  // =====================================
  // NEXBIT MOBILE NAVIGATION
  // =====================================

  const menuToggle = document.getElementById("menuToggle");
  const navLinks = document.getElementById("navLinks");

  if (menuToggle && navLinks) {
    menuToggle.addEventListener("click", () => {
      navLinks.classList.toggle("open");
    });

    navLinks.querySelectorAll("a").forEach(link => {
      link.addEventListener("click", () => {
        navLinks.classList.remove("open");
      });
    });
  }


  // =====================================
  // NEXBIT SMOOTH SCROLLING
  // =====================================

  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener("click", event => {
      const href = link.getAttribute("href");

      if (!href || href === "#") return;

      const target = document.querySelector(href);

      if (target) {
        event.preventDefault();

        target.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }
    });
  });


  // =====================================
  // NEXBIT INVESTMENT CARD ANIMATION
  // =====================================

function initializeInvestmentAnimation() {
  const cards = document.querySelectorAll(
    ".nexbit-investments .investment-card"
  );

  if (!cards.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
      } else {
        entry.target.classList.remove("is-visible");
      }
    });
  }, {
    threshold: 0.05,
    rootMargin: "0px 0px -30px 0px"
  });

  cards.forEach((card, index) => {
    card.classList.add("reveal-ready");
    card.style.transitionDelay = `${index * 0.2}s`;
    observer.observe(card);
  });
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeInvestmentAnimation
  );
} else {
  initializeInvestmentAnimation();
}

  
// =====================================
// NEXBIT LIVE MARKET TICKER
// =====================================

async function loadNexbitTicker() {
  const ticker = document.getElementById("ticker-track");
  if (!ticker) return;

  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,solana,binancecoin,ripple,dogecoin&price_change_percentage=24h",
      { signal: AbortSignal.timeout(12000) }
    );

    if (!response.ok) {
      throw new Error("Market data unavailable");
    }

    const coins = await response.json();

    const tickerContent = coins.map(coin => {
      const change = coin.price_change_percentage_24h ?? 0;
      const direction = change >= 0 ? "up" : "down";
      const sign = change >= 0 ? "+" : "";

      return `
        <div class="ticker-card">
          <img src="${coin.image}" alt="${coin.name} logo">
          <div class="ticker-info">
            <span class="ticker-name">${coin.symbol.toUpperCase()}/USDT</span>
            <span class="ticker-price">
              $${Number(coin.current_price).toLocaleString("en-US")}
            </span>
          </div>
          <span class="ticker-change ${direction}">
            ${sign}${change.toFixed(2)}%
          </span>
        </div>
      `;
    }).join("");

    ticker.innerHTML = tickerContent + tickerContent;

  } catch (error) {
    console.error("NEXBIT CoinGecko ticker error:", error);

    try {
      const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
      const backupUrl =
        "https://api.binance.com/api/v3/ticker/24hr?symbols=" +
        encodeURIComponent(JSON.stringify(symbols));
      const backupResponse = await fetch(backupUrl, { signal: AbortSignal.timeout(12000) });

      if (!backupResponse.ok) {
        throw new Error("Backup ticker request failed");
      }

      const backupCoins = await backupResponse.json();
      const tickerContent = backupCoins.map(coin => {
        const symbol = coin.symbol.replace("USDT", "");
        const change = Number(coin.priceChangePercent) || 0;
        const direction = change >= 0 ? "up" : "down";
        const sign = change >= 0 ? "+" : "";

        return `
          <div class="ticker-card">
            <div class="ticker-info">
            <img src="${NEXBIT_COIN_LOGOS[symbol] || ""}" alt="${symbol} logo" onerror="this.style.display=\'none\'">
            <span class="ticker-name">${symbol}/USDT</span>
              <span class="ticker-price">
                ${Number(coin.lastPrice).toLocaleString("en-US")}
              </span>
            </div>
            <span class="ticker-change ${direction}">
              ${sign}${change.toFixed(2)}%
            </span>
          </div>
        `;
      }).join("");

      if (!tickerContent) {
        throw new Error("No backup ticker data received");
      }

      ticker.innerHTML = tickerContent + tickerContent;
    } catch (backupError) {
      console.error("NEXBIT backup ticker error:", backupError);
      ticker.innerHTML =
        "<span>Live market data temporarily unavailable.</span>";
    }
  }
}

loadNexbitTicker();
setInterval(loadNexbitTicker, 60000);

// NEXBIT REVIEW SLIDER — measured one-card movement.
function initializeNexbitReviewSlider() {
  const viewport = document.getElementById("nexbitVoicesWindow");
  const track = document.getElementById("nexbitVoicesTrack");
  if (!viewport || !track) return;

  const pages = Array.from(track.querySelectorAll(".nexbit-voices-page"));
  const previous = document.getElementById("nexbitVoicesPrev");
  const next = document.getElementById("nexbitVoicesNext");
  const dots = Array.from(document.querySelectorAll(".nexbit-voices-dot"));
  if (!pages.length) return;

  let currentPage = 0;
  let pointerStart = null;
  let pointerDelta = 0;

  track.style.display = "flex";
  track.style.gap = "0";
  track.style.padding = "0";
  track.style.transition = "transform .65s cubic-bezier(.22,1,.36,1)";

  function setDimensions() {
    const width = viewport.clientWidth;
    track.style.width = (width * pages.length) + "px";
    pages.forEach(page => {
      page.style.flex = "0 0 " + width + "px";
      page.style.width = width + "px";
      page.style.minWidth = width + "px";
      page.style.boxSizing = "border-box";
    });
    showPage(currentPage, false);
  }

  function showPage(index, animate = true) {
    currentPage = Math.max(0, Math.min(pages.length - 1, index));
    const width = viewport.clientWidth;
    track.style.transition = animate ? "transform .65s cubic-bezier(.22,1,.36,1)" : "none";
    track.style.transform = "translate3d(" + (-currentPage * width) + "px,0,0)";
    pages.forEach((page, pageIndex) => {
      page.querySelectorAll(".nexbit-voice-card").forEach(card => {
        card.classList.toggle("is-visible", pageIndex === currentPage);
      });
    });
    if (previous) previous.disabled = currentPage === 0;
    if (next) next.disabled = currentPage === pages.length - 1;
    dots.forEach((dot, dotIndex) => {
      const active = dotIndex === currentPage;
      dot.classList.toggle("is-active", active);
      if (active) dot.setAttribute("aria-current", "true");
      else dot.removeAttribute("aria-current");
    });
  }

  if (previous) previous.addEventListener("click", () => showPage(currentPage - 1));
  if (next) next.addEventListener("click", () => showPage(currentPage + 1));
  dots.forEach(dot => dot.addEventListener("click", () => showPage(Number(dot.dataset.reviewPage))));

  viewport.addEventListener("pointerdown", event => {
    if (event.target.closest("button")) return;
    pointerStart = event.clientX;
    pointerDelta = 0;
    viewport.classList.add("is-dragging");
    if (viewport.setPointerCapture) viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener("pointermove", event => {
    if (pointerStart !== null) pointerDelta = event.clientX - pointerStart;
  });
  function finishSwipe() {
    if (pointerStart === null) return;
    if (Math.abs(pointerDelta) > 45) {
      showPage(currentPage + (pointerDelta < 0 ? 1 : -1));
    }
    pointerStart = null;
    pointerDelta = 0;
    viewport.classList.remove("is-dragging");
  }
  viewport.addEventListener("pointerup", finishSwipe);
  viewport.addEventListener("pointercancel", finishSwipe);
  viewport.addEventListener("lostpointercapture", finishSwipe);

  window.addEventListener("resize", setDimensions);
  setDimensions();
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeNexbitReviewSlider);
} else {
  initializeNexbitReviewSlider();
}

});