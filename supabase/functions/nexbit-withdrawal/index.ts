import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

async function getEthUsdPrice(): Promise<number> {
  const response = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT", {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Live ETH price is temporarily unavailable");
  const data = await response.json();
  const price = Number(data.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Live ETH price is invalid");
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
    if (!url || !anonKey || !serviceKey) return json({ error: "Withdrawal service is not configured" }, 503);

    const authClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: "Bearer " + token } },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Your session is invalid. Please sign in again" }, 401);

    const body = await req.json();
    const action = String(body.action || "").toLowerCase();
    const asset = String(body.asset || body.asset_code || "").trim().toUpperCase();
    const network = String(body.network || "").trim();
    const amount = Number(body.amount);
    if (!["quote", "submit"].includes(action)) return json({ error: "Invalid withdrawal action" }, 400);
    if (!/^[A-Z0-9]{2,12}$/.test(asset)) return json({ error: "Select a valid asset" }, 400);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e18) return json({ error: "Enter a valid withdrawal amount" }, 400);
    if (network.length < 2 || network.length > 40) return json({ error: "Select a valid network" }, 400);

    const feeApplies = asset === "USDT" && /(ethereum|erc\s*-?20)/i.test(network);
    let ethUsdPrice: number | null = null;
    let feeUsd = 0;
    let feeEth = 0;
    if (feeApplies) {
      ethUsdPrice = await getEthUsdPrice();
      feeUsd = Number((amount * 0.0015).toFixed(8));
      feeEth = Math.ceil((feeUsd / ethUsdPrice) * 1e8) / 1e8;
    }
    if (action === "quote") {
      return json({ fee_applies: feeApplies, fee_usd: feeUsd, fee_eth: feeEth, eth_usd_price: ethUsdPrice });
    }

    const destination = String(body.destination_address || "").trim();
    const note = String(body.user_note || "").trim();
    const idempotencyKey = String(body.idempotency_key || "");
    if (destination.length < 8 || destination.length > 256) return json({ error: "Enter a valid receiving wallet address" }, 400);
    if (note.length > 500) return json({ error: "Note is too long" }, 400);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
      return json({ error: "Invalid withdrawal request reference" }, 400);
    }

    const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await service.rpc("nexbit_submit_withdrawal_request", {
      p_user_id: authData.user.id,
      p_asset_code: asset,
      p_amount: amount,
      p_network: network,
      p_destination_address: destination,
      p_user_note: note || null,
      p_eth_usd_price: ethUsdPrice,
      p_idempotency_key: idempotencyKey,
    });
    if (error) return json({ error: error.message || "Withdrawal request could not be submitted" }, 400);
    return json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Withdrawal service temporarily unavailable";
    return json({ error: message }, 503);
  }
});