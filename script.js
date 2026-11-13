
document.addEventListener("DOMContentLoaded", () => {
  // NEXBIT sample market data.
  // These are demonstration prices, not live exchange prices.
  const markets = [
    {
      name: "Bitcoin",
      symbol: "BTC",
      price: 97450.25,
      change: 2.45
    },
    {
      name: "Ethereum",
      symbol: "ETH",
      price: 3240.80,
      change: 1.82
    },
    {
      name: "Solana",
      symbol: "SOL",
      price: 185.60,
      change: 4.25
    },
    {
      name: "BNB",
      symbol: "BNB",
      price: 645.30,
      change: -0.75
    }
  ];

  const marketTable = document.querySelector(".market-table");

  if (marketTable) {
    // Remove any previous sample rows before adding the new ones.
    marketTable.querySelectorAll(".market-row").forEach(row => {
      row.remove();
    });

    markets.forEach(coin => {
      const row = document.createElement("div");
      row.className = "market-row";

      const changeColor = coin.change >= 0 ? "#32c98b" : "#ef6262";
      const changeSign = coin.change >= 0 ? "+" : "";

      row.innerHTML = `
        <span>
          <strong>${coin.name}</strong>
          <small style="color:#929292; margin-left:8px;">
            ${coin.symbol}
          </small>
        </span>
        <span>$${coin.price.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })}</span>
        <span style="color:${changeColor}">
          ${changeSign}${coin.change.toFixed(2)}%
        </span>
      `;

      marketTable.appendChild(row);
    });
  }

  // Add a clear demonstration-data notice.
  const demoNote = document.querySelector(".demo-note");

  if (demoNote) {
    demoNote.textContent =
      "Demo market data only. Prices are illustrative and are not live trading prices.";
  }

  // Smooth scrolling for links that point to sections on this page.
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

  console.log("NEXBIT website initialized successfully.");
});
