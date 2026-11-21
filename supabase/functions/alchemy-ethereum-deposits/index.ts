// NEXBIT Ethereum deposit webhook (ETH + official Ethereum USDT).
// This function records verified on-chain deposits for admin review only.
// It never assigns a user and never credits a balance.

const USDT_ETH_CONTRACT = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-alchemy-signature",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyAlchemySignature(rawBody: string, signature: string, signingKey: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  return constantTimeEqual(toHex(digest).toLowerCase(), signature.trim().toLowerCase());
}

async function rpc(rpcUrl: string, method: string, params: unknown[]) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error("Ethereum RPC request failed");
  const payload = await response.json();
  if (payload.error) throw new Error("Ethereum RPC returned an error");
  return payload.result;
}

function hexToBigInt(value: string | undefined) {
  if (!value || !/^0x[0-9a-f]+$/i.test(value)) return 0n;
  return BigInt(value);
}

function formatUnits(raw: bigint, decimals: number) {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const fraction = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? whole.toString() + "." + fraction : whole.toString();
}

function normalizeAddress(value: string | undefined) {
  return (value || "").toLowerCase();
}

function topicAddress(topic: string | undefined) {
  if (!topic || !/^0x[0-9a-f]{64}$/i.test(topic)) return "";
  return "0x" + topic.slice(-40).toLowerCase();
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const signingKey = Deno.env.get("ALCHEMY_SIGNING_KEY");
  const rpcUrl = Deno.env.get("ALCHEMY_ETH_RPC_URL");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY");

  if (!signingKey || !rpcUrl || !supabaseUrl || !serviceKey) {
    return json({ error: "Server configuration is incomplete" }, 500);
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-alchemy-signature") || "";
  if (!signature || !(await verifyAlchemySignature(rawBody, signature, signingKey))) {
    return json({ error: "Invalid webhook signature" }, 401);
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (payload.type !== "ADDRESS_ACTIVITY" || payload.event?.network !== "ETH_MAINNET") {
    return json({ received: true, ignored: "Unsupported webhook event or network" });
  }

  const supabaseHeaders = {
    apikey: serviceKey,
    Authorization: "Bearer " + serviceKey,
    "Content-Type": "application/json",
  };

  const addressResponse = await fetch(
    supabaseUrl + "/rest/v1/nexbit_deposit_addresses?is_active=eq.true&select=asset_code,network,address",
    { headers: supabaseHeaders },
  );
  if (!addressResponse.ok) return json({ error: "Could not load configured deposit addresses" }, 500);
  const configuredAddresses = await addressResponse.json();

  const deposits: any[] = [];
  const activities = Array.isArray(payload.event.activity) ? payload.event.activity : [];

  for (const activity of activities) {
    const recipient = normalizeAddress(activity.toAddress);
    if (!recipient || !activity.hash) continue;

    let assetCode = "";
    let matchingAddress: any = null;
    let amount = "";
    let eventIndex = "0";
    let metadata: Record<string, unknown> = {
      provider: "alchemy",
      webhook_event_id: payload.id || null,
      block_number: activity.blockNum || null,
      from_address: activity.fromAddress || null,
    };

    const category = String(activity.category || "").toLowerCase();
    const contractAddress = normalizeAddress(activity.rawContract?.address);

    if ((category === "external" || category === "internal") &&
        String(activity.asset || "").toUpperCase() === "ETH") {
      assetCode = "ETH";
      matchingAddress = configuredAddresses.find((row: any) =>
        String(row.asset_code).toUpperCase() === "ETH" &&
        String(row.network).toLowerCase().includes("ethereum") &&
        normalizeAddress(row.address) === recipient
      );
    } else if ((category === "token" || category === "erc20") &&
        contractAddress === USDT_ETH_CONTRACT) {
      assetCode = "USDT";
      matchingAddress = configuredAddresses.find((row: any) =>
        String(row.asset_code).toUpperCase() === "USDT" &&
        String(row.network).toLowerCase().includes("ethereum") &&
        normalizeAddress(row.address) === recipient
      );
    }

    if (!assetCode || !matchingAddress) continue;

    const receipt = await rpc(rpcUrl, "eth_getTransactionReceipt", [activity.hash]);
    if (!receipt || receipt.status !== "0x1" || !receipt.blockNumber) continue;

    const latestBlockHex = await rpc(rpcUrl, "eth_blockNumber", []);
    const confirmationsBig = hexToBigInt(latestBlockHex) - hexToBigInt(receipt.blockNumber) + 1n;
    const confirmations = Number(confirmationsBig > 0n ? confirmationsBig : 0n);

    if (assetCode === "ETH") {
      const tx = await rpc(rpcUrl, "eth_getTransactionByHash", [activity.hash]);
      if (!tx || normalizeAddress(tx.to) !== recipient) continue;
      const rawWei = hexToBigInt(tx.value);
      if (rawWei <= 0n) continue;
      amount = formatUnits(rawWei, 18);
      metadata = { ...metadata, block_number: receipt.blockNumber, transaction_status: receipt.status };
    } else {
      const transferLog = (receipt.logs || []).find((log: any) => {
        const topics = log.topics || [];
        return normalizeAddress(log.address) === USDT_ETH_CONTRACT &&
          String(topics[0] || "").toLowerCase() === TRANSFER_TOPIC &&
          topicAddress(topics[2]) === recipient &&
          (!activity.log?.logIndex || String(log.logIndex).toLowerCase() === String(activity.log.logIndex).toLowerCase());
      });
      if (!transferLog) continue;
      const rawAmount = hexToBigInt(transferLog.data);
      if (rawAmount <= 0n) continue;
      amount = formatUnits(rawAmount, 6);
      eventIndex = String(transferLog.logIndex || "0");
      metadata = {
        ...metadata,
        block_number: receipt.blockNumber,
        token_contract: USDT_ETH_CONTRACT,
        transaction_status: receipt.status,
      };
    }

    deposits.push({
      asset_code: assetCode,
      network: "Ethereum",
      amount,
      tx_hash: activity.hash,
      event_index: eventIndex,
      deposit_address: matchingAddress.address,
      confirmations,
      status: "awaiting_review",
      detected_at: new Date().toISOString(),
      metadata,
    });
  }

  if (deposits.length) {
    const insertResponse = await fetch(
      supabaseUrl + "/rest/v1/nexbit_detected_deposits?on_conflict=network,asset_code,tx_hash,event_index",
      {
        method: "POST",
        headers: {
          ...supabaseHeaders,
          Prefer: "resolution=ignore-duplicates,return=minimal",
        },
        body: JSON.stringify(deposits),
      },
    );
    if (!insertResponse.ok) {
      const detail = await insertResponse.text();
      console.error("Deposit insert failed", detail);
      return json({ error: "Could not save detected deposits" }, 500);
    }
  }

  return json({ received: true, deposits_processed: deposits.length });
});
