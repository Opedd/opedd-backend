import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  encodeFunctionData,
  decodeFunctionResult,
  type Hex,
} from "https://esm.sh/viem@2";
import { privateKeyToAccount } from "https://esm.sh/viem@2/accounts";
import { baseSepolia } from "https://esm.sh/viem@2/chains";
import { logEvent } from "./events.ts";

// ── Minimal ABI (only the functions we call) ──────────────────────────

const REGISTRY_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "keyHash", type: "bytes32" },
      { name: "contentHash", type: "bytes32" },
      { name: "documentHash", type: "bytes32" },
      { name: "licenseType", type: "uint8" },
      { name: "intendedUse", type: "uint8" },
      { name: "publisher", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "verify",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "keyHash", type: "bytes32" }],
    outputs: [
      { name: "valid", type: "bool" },
      { name: "contentHash", type: "bytes32" },
      { name: "documentHash", type: "bytes32" },
      { name: "licenseType", type: "uint8" },
      { name: "intendedUse", type: "uint8" },
      { name: "issuedAt", type: "uint40" },
      { name: "publisher", type: "address" },
    ],
  },
  {
    name: "isRegistered",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "keyHash", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ── Mappings ──────────────────────────────────────────────────────────

function licenseTypeToUint8(type: string): number {
  return type === "human" ? 1 : type === "ai" ? 2 : 0;
}

function intendedUseToUint8(use: string | null): number {
  const map: Record<string, number> = {
    personal: 1,
    editorial: 2,
    commercial: 3,
    ai_training: 4,
    corporate: 5,
  };
  return use ? map[use] ?? 0 : 0;
}

// ── Lazy singleton clients ────────────────────────────────────────────

let _publicClient: ReturnType<typeof createPublicClient> | null = null;
let _walletClient: ReturnType<typeof createWalletClient> | null = null;
let _account: ReturnType<typeof privateKeyToAccount> | null = null;
let _contractAddress: Hex | null = null;

function getConfig(): { publicClient: typeof _publicClient; walletClient: typeof _walletClient; account: typeof _account; contractAddress: Hex } | null {
  if (_publicClient) {
    return { publicClient: _publicClient, walletClient: _walletClient, account: _account, contractAddress: _contractAddress! };
  }

  const rpc = Deno.env.get("BASE_SEPOLIA_RPC");
  const pk = Deno.env.get("DEPLOYER_PRIVATE_KEY");
  const addr = Deno.env.get("REGISTRY_CONTRACT_ADDRESS");

  if (!rpc || !pk || !addr) {
    console.warn("[blockchain] Missing env vars — on-chain registration disabled");
    return null;
  }

  _account = privateKeyToAccount(pk as Hex);
  _contractAddress = addr as Hex;

  _publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpc),
  });

  _walletClient = createWalletClient({
    chain: baseSepolia,
    transport: http(rpc),
    account: _account,
  });

  return { publicClient: _publicClient, walletClient: _walletClient, account: _account, contractAddress: _contractAddress };
}

// ── Hash helpers ──────────────────────────────────────────────────────

function hashLicenseKey(licenseKey: string): Hex {
  return keccak256(toHex(licenseKey));
}

const ZERO_HASH: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";
const ZERO_ADDRESS: Hex = "0x0000000000000000000000000000000000000000";

// Hash article data to produce a meaningful contentHash
function hashContent(articleId: string, articleTitle?: string, sourceUrl?: string): Hex {
  const content = `${articleId}:${articleTitle || ""}:${sourceUrl || ""}`;
  return keccak256(toHex(content));
}

// ── Public API ────────────────────────────────────────────────────────

export interface RegisterParams {
  licenseKey: string;
  articleId: string;
  licenseType: string;
  intendedUse: string | null;
  transactionId: string;
  publisherId: string | null;
  articleTitle?: string;
  sourceUrl?: string;
}

/**
 * Register a license on-chain. Non-blocking: catches all errors, never throws.
 * Returns the tx hash or null if registration was skipped/failed.
 */
export async function registerOnChain(
  supabase: SupabaseClient,
  params: RegisterParams
): Promise<string | null> {
  const config = getConfig();
  if (!config) return null;

  const { publicClient, walletClient, account, contractAddress } = config;

  try {
    const keyHash = hashLicenseKey(params.licenseKey);
    const ltUint8 = licenseTypeToUint8(params.licenseType);
    const iuUint8 = intendedUseToUint8(params.intendedUse);

    // Build content hash from article data (or fallback to zero)
    const contentHash = (params.articleTitle || params.sourceUrl)
      ? hashContent(params.articleId, params.articleTitle, params.sourceUrl)
      : ZERO_HASH;
    // Document hash = hash of articleId (unique per article)
    const documentHash = keccak256(toHex(params.articleId));

    // Send the transaction
    const txHash = await walletClient!.writeContract({
      address: contractAddress,
      abi: REGISTRY_ABI,
      functionName: "register",
      args: [
        keyHash,
        contentHash,
        documentHash,
        ltUint8,
        iuUint8,
        ZERO_ADDRESS,     // publisher address — requires publisher wallet, skip for now
      ],
    });

    console.log(`[blockchain] Tx submitted: ${txHash} for ${params.licenseKey}`);

    // Immediately update DB with submitted status
    await supabase
      .from("license_transactions")
      .update({ blockchain_tx_hash: txHash, blockchain_status: "submitted" })
      .eq("id", params.transactionId);

    // Background: wait for confirmation and update status
    (async () => {
      try {
        const receipt = await publicClient!.waitForTransactionReceipt({ hash: txHash });
        const status = receipt.status === "success" ? "confirmed" : "failed";

        await supabase
          .from("license_transactions")
          .update({ blockchain_status: status })
          .eq("id", params.transactionId);

        if (status === "confirmed") {
          await logEvent(supabase, {
            event_type: "license.registered_onchain",
            license_key: params.licenseKey,
            transaction_id: params.transactionId,
            article_id: params.articleId,
            publisher_id: params.publisherId,
            actor_type: "system",
            metadata: { tx_hash: txHash, chain: "base_sepolia", contract: contractAddress },
          });
          console.log(`[blockchain] Confirmed: ${txHash}`);
        } else {
          console.error(`[blockchain] Tx failed on-chain: ${txHash}`);
        }
      } catch (err) {
        console.error("[blockchain] Receipt wait error:", err instanceof Error ? err.message : err);
        await supabase
          .from("license_transactions")
          .update({ blockchain_status: "failed" })
          .eq("id", params.transactionId);
      }
    })();

    return txHash;
  } catch (err) {
    console.error("[blockchain] Register error:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Verify a license on-chain (read-only, no gas).
 * Returns proof data or null if not registered / env not configured.
 */
export async function verifyOnChain(
  licenseKey: string
): Promise<{
  registered: boolean;
  valid: boolean;
  licenseType: number;
  intendedUse: number;
  issuedAt: number;
  chain: string;
  contract: string;
} | null> {
  const config = getConfig();
  if (!config) return null;

  const { publicClient, contractAddress } = config;

  try {
    const keyHash = hashLicenseKey(licenseKey);

    const data = await publicClient!.readContract({
      address: contractAddress,
      abi: REGISTRY_ABI,
      functionName: "verify",
      args: [keyHash],
    });

    // data is a tuple: [valid, contentHash, documentHash, licenseType, intendedUse, issuedAt, publisher]
    const [valid, , , licenseType, intendedUse, issuedAt] = data as [boolean, Hex, Hex, number, number, number, Hex];

    return {
      registered: issuedAt > 0,
      valid,
      licenseType,
      intendedUse,
      issuedAt,
      chain: "base_sepolia",
      contract: contractAddress,
    };
  } catch (err) {
    console.error("[blockchain] Verify error:", err instanceof Error ? err.message : err);
    return null;
  }
}
