
document.addEventListener("DOMContentLoaded", () => {

  // =====================================
  // NEXBIT MARKET TABLE
  // =====================================

  const demoNote = document.querySelector(".demo-note");

  const sampleMarkets = [
    { name: "Bitcoin", symbol: "BTC", price: 97450.25, change: 2.45 },
    { name: "Ethereum", symbol: "ETH", price: 3240.80, change: 1.82 },
    { name: "Solana", symbol: "SOL", price: 185.60, change: 4.25 },
    { name: "BNB", symbol: "BNB", price: 645.30, change: -0.75 }
  ];

  function displayMarkets(markets) {
    const marketList = document.getElementById("market-list");
    if (!marketList) return;

    marketList.innerHTML = "";

    markets.forEach(coin => {
      const row = document.createElement("div");
      row.className = "market-row";

      const nameCell = document.createElement("span");
      nameCell.style.cssText =
        "display:flex;align-items:center;gap:10px;";

      const logo = document.createElement("img");
      logo.src = coin.image || "";
      logo.alt = coin.name;
      logo.style.cssText =
        "width:28px;height:28px;border-radius:50%;";

      const name = document.createElement("strong");
      name.textContent = coin.name;

      const symbol = document.createElement("small");
      symbol.textContent = coin.symbol;
      symbol.style.cssText = "color:#929292;margin-left:5px;";

      nameCell.append(logo, name, symbol);

      const priceCell = document.createElement("span");
      priceCell.textContent =
        "$" + Number(coin.price).toLocaleString("en-US");

      const changeCell = document.createElement("span");
      const change = Number(coin.change) || 0;
      const positive = change >= 0;

      changeCell.textContent =
        (positive ? "+" : "") + change.toFixed(2) + "%";

      changeCell.style.cssText = `
        display:inline-block;
        width:max-content;
        padding:6px 9px;
        border-radius:7px;
        font-size:11px;
        font-weight:800;
        color:${positive ? "#21d68b" : "#ff5b65"};
        background:${positive ? "rgba(33,214,139,0.12)" : "rgba(255,91,101,0.12)"};
        border:1px solid ${positive ? "rgba(33,214,139,0.3)" : "rgba(255,91,101,0.3)"};
      `;

      const marketCell = document.createElement("span");

      const cap = document.createElement("small");
      cap.textContent = coin.marketCap
        ? "$" + Number(coin.marketCap).toLocaleString("en-US")
        : "--";

      cap.style.cssText =
        "display:block;color:#aaa;font-size:10px;";

      marketCell.appendChild(cap);

      const values = coin.sparkline || [];

      if (values.length > 1) {
        const svg = document.createElementNS(
          "http://www.w3.org/2000/svg", "svg"
        );

        svg.setAttribute("viewBox", "0 0 100 30");
        svg.setAttribute("width", "90");
        svg.setAttribute("height", "30");

        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1;

        const points = values.map((value, index) => {
          const x = (index / (values.length - 1)) * 100;
          const y = 27 - ((value - min) / range) * 24;
          return `${x},${y}`;
        }).join(" ");

        const line = document.createElementNS(
          "http://www.w3.org/2000/svg", "polyline"
        );

        line.setAttribute("points", points);
        line.setAttribute("fill", "none");
        line.setAttribute(
          "stroke", Number(coin.change) >= 0 ? "#21d68b" : "#ff5b65"
        );
        line.setAttribute("stroke-width", "2");
        line.setAttribute("stroke-linecap", "round");
        line.setAttribute("stroke-linejoin", "round");

        svg.appendChild(line);
        marketCell.appendChild(svg);
      }

      row.append(nameCell, priceCell, changeCell, marketCell);
      marketList.appendChild(row);
    });
  }

  async function loadMarkets() {
    if (demoNote) {
      demoNote.textContent = "Loading cryptocurrency prices...";
    }

    try {
      const url =
        "https://api.coingecko.com/api/v3/coins/markets" +
        "?vs_currency=usd" +
        "&ids=bitcoin,ethereum,solana,binancecoin" +
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
        const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];
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
          BNB: "BNB"
        };

        const backupMarkets = backupData.map(coin => ({
          name: names[coin.symbol.replace("USDT", "")] || coin.symbol,
          symbol: coin.symbol.replace("USDT", ""),
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
