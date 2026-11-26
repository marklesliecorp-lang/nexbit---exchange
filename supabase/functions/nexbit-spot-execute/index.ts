import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const allowed = new Set(["BTC","ETH","SOL","BNB","XRP","DOGE","ADA","TRX","USDT"]);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

async function usdtPrice(asset: string): Promise<number> {
  if (asset === "USD" || asset === "USDT") return 1;
  const response = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=" + asset + "USDT", {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Unable to retrieve the live " + asset + " market price");
  const data = await response.json();
  const price = Number(data.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error("The live " + asset + " price is unavailable");
  return price;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) return json({ error: "Please sign in again" }, 401);
    const token = authorization.slice(7);
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) return json({ error: "Trading service is not configured" }, 503);

    const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: "Bearer " + token } } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Your session is invalid. Please sign in again" }, 401);

    const body = await req.json();
    const action = String(body.action || "").toLowerCase();
    const amount = Number(body.amount);
    const idempotencyKey = String(body.idempotencyKey || "");
    const fromAsset = String(body.fromAsset || (action === "buy" ? "USD" : "")).toUpperCase();
    const toAsset = String(body.toAsset || (action === "sell" ? "USD" : "")).toUpperCase();
    if (!["buy", "sell", "convert"].includes(action)) return json({ error: "Choose Buy, Sell or Convert" }, 400);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e18 || Number(amount.toFixed(12)) !== amount) return json({ error: "Enter a valid amount with up to 12 decimal places" }, 400);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) return json({ error: "Invalid execution reference" }, 400);
    if (action === "buy" && (!allowed.has(toAsset) || toAsset === "USDT")) return json({ error: "Select a supported crypto asset" }, 400);
    if (action === "sell" && (!allowed.has(fromAsset) || fromAsset === "USDT")) return json({ error: "Select a supported crypto asset" }, 400);
    if (action === "convert" && (!allowed.has(fromAsset) || !allowed.has(toAsset) || fromAsset === toAsset)) return json({ error: "Select two different supported assets" }, 400);
    if (action === "buy" && fromAsset !== "USD") return json({ error: "Invalid Buy source wallet" }, 400);
    if (action === "sell" && toAsset !== "USD") return json({ error: "Invalid Sell destination wallet" }, 400);

    const [fromPrice, toPrice] = await Promise.all([usdtPrice(fromAsset), usdtPrice(toAsset)]);
    const quoteAt = new Date().toISOString();
    const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await service.rpc("nexbit_execute_spot_trade", {
      p_user_id: authData.user.id,
      p_action: action,
      p_from_asset: fromAsset,
      p_to_asset: toAsset,
      p_amount: amount,
      p_from_price_usdt: fromPrice,
      p_to_price_usdt: toPrice,
      p_quote_at: quoteAt,
      p_idempotency_key: idempotencyKey,
    });
    if (error) {
      const message = error.message || "Trade could not be completed";
      return json({ error: message.replace(/^.*?ERROR:\\s*/i, "") }, 400);
    }
    return json({ ...data, fromAsset, toAsset });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Trade service temporarily unavailable";
    return json({ error: message }, 503);
  }
});
