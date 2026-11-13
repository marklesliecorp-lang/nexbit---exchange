
document.addEventListener("DOMContentLoaded", () => {
  const marketTable = document.querySelector(".market-table");
  const demoNote = document.querySelector(".demo-note");

  const sampleMarkets = [
    { name: "Bitcoin", symbol: "BTC", price: 97450.25, change: 2.45 },
    { name: "Ethereum", symbol: "ETH", price: 3240.80, change: 1.82 },
    { name: "Solana", symbol: "SOL", price: 185.60, change: 4.25 },
    { name: "BNB", symbol: "BNB", price: 645.30, change: -0.75 }
  ];

  function displayMarkets(markets) {
    if (!marketTable) return;

    marketTable.querySelectorAll(".market-row").forEach(row => row.remove());

    markets.forEach(coin => {
      const row = document.createElement("div");
      row.className = "market-row";

      const nameCell = document.createElement("span");
      const name = document.createElement("strong");
      const symbol = document.createElement("small");

      name.textContent = coin.name;
      symbol.textContent = coin.symbol;
      symbol.style.cssText = "color:#929292;margin-left:8px";

      nameCell.append(name, symbol);

      const priceCell = document.createElement("span");
      priceCell.textContent = "$" + Number(coin.price).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });

      const changeCell = document.createElement("span");
      const change = Number(coin.change) || 0;
      changeCell.textContent = (change >= 0 ? "+" : "") + change.toFixed(2) + "%";
      changeCell.style.color = change >= 0 ? "#32c98b" : "#ef6262";

      row.append(nameCell, priceCell, changeCell);
      marketTable.appendChild(row);
    });
  }

  async function loadMarkets() {
    if (demoNote) demoNote.textContent = "Loading cryptocurrency prices...";

    try {
      const url =
        "https://api.coingecko.com/api/v3/coins/markets" +
        "?vs_currency=usd" +
        "&ids=bitcoin,ethereum,solana,binancecoin" +
        "&price_change_percentage=24h";

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error("Market data request failed");
      }

      const data = await response.json();

      if (!Array.isArray(data) || data.length === 0) {
        throw new Error("No market data received");
      }

      const markets = data.map(coin => ({
        name: coin.name,
        symbol: coin.symbol.toUpperCase(),
        price: coin.current_price,
        change: coin.price_change_percentage_24h || 0
      }));

      displayMarkets(markets);

      if (demoNote) {
        demoNote.textContent =
          "Indicative market prices supplied by CoinGecko. Not executable trading quotes.";
      }

    } catch (error) {
      console.error("NEXBIT market data error:", error);

      displayMarkets(sampleMarkets);

      if (demoNote) {
        demoNote.textContent =
          "Live prices unavailable. Showing demonstration prices instead.";
      }
    }
  }

  // Load prices when the page opens.
  loadMarkets();

  // Refresh market prices every 60 seconds.
  setInterval(loadMarkets, 60000);

  // Smooth scrolling for page links.
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener("click", event => {
      const target = document.querySelector(link.getAttribute("href"));

      if (target) {
        event.preventDefault();
        target.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }
    });
  });

  console.log("NEXBIT initialized.");
});

// NEXBIT MOBILE NAVIGATION
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
