import type { GetTransactionMeta, GetTransactionResponse, TokenBalance, TransactionMessage } from "../types/solana";

export function parseSignature(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    // Accept Solscan, SolanaFM, Explorer URLs or raw signature
    const m = trimmed.match(/(?:solscan\.io\/tx\/|explorer\.solana\.com\/tx\/|solanafm\.com\/tx\/|^)([1-9A-HJ-NP-Za-km-z]{87,88})/);
    return m ? m[1] : null;
}


export function short(addr?: string, len = 4) {
    if (!addr) return "-";
    return `${addr.slice(0, 4 + len)}…${addr.slice(-len)}`;
}


export function detectRpcUrl() {
    const helius = import.meta.env.VITE_HELIUS_API_KEY as string | undefined;
    if (helius) return `https://mainnet.helius-rpc.com/?api-key=${helius}`;
    return "https://api.mainnet-beta.solana.com"; // fallback (public, rate-limited)
}


export async function rpcGetTransaction(signature: string): Promise<GetTransactionResponse | null> {
    const body = {
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
    };
    const res = await fetch(detectRpcUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    return data?.result ?? null;
}


export function findDeltaSOL(meta: GetTransactionMeta, message: TransactionMessage, recipient?: string) {
    const { preBalances, postBalances } = meta;
    let bestIdx = -1;
    let bestDelta = 0;
    for (let i = 0; i < preBalances.length; i++) {
        const delta = (postBalances[i] ?? 0) - (preBalances[i] ?? 0);
        if (recipient) {
            if (message.accountKeys[i]?.pubkey === recipient) {
                return { index: i, deltaLamports: delta };
            }
        } else if (delta > bestDelta) {
            bestDelta = delta;
            bestIdx = i;
        }
    }
    if (recipient) return { index: -1, deltaLamports: 0 };
    return { index: bestIdx, deltaLamports: bestDelta };
}




export function findDeltaSPL(meta: GetTransactionMeta, message: TransactionMessage, recipient?: string) {
    const pre = meta.preTokenBalances ?? [];
    const post = meta.postTokenBalances ?? [];
    // Map by accountIndex+mint
    const key = (b: TokenBalance) => `${b.accountIndex}:${b.mint}`;
    const preMap = new Map(pre.map((b) => [key(b), b]));
    let best: { accountIndex: number; mint: string; decimals: number; delta: number; owner?: string } | null = null;
    for (const pb of post) {
        const p = preMap.get(key(pb));
        const dec = pb.uiTokenAmount.decimals ?? 0;
        const amountPost = Number(pb.uiTokenAmount.amount);
        const amountPre = Number(p?.uiTokenAmount.amount ?? 0);
        const delta = amountPost - amountPre; // raw units (not 10^decimals)
        const pubkey = message.accountKeys[pb.accountIndex]?.pubkey;
        const owner = pb.owner;
        if (recipient) {
            if (owner === recipient || pubkey === recipient) {
                return { accountIndex: pb.accountIndex, mint: pb.mint, decimals: dec, delta, owner };
            }
        } else if (delta > (best?.delta ?? 0)) {
            best = { accountIndex: pb.accountIndex, mint: pb.mint, decimals: dec, delta, owner };
        }
    }
    return best;
}


export function inferParties(message: TransactionMessage) {
    // Heuristic: first writable non-signer key after fee payer is often recipient for simple transfers
    const keys = message.accountKeys;
    const feePayer = keys[0]?.pubkey;
    const possibleSender = feePayer;
    const possibleRecipient = keys.find((k, i) => i > 0 && k.writable)?.pubkey;
    return { sender: possibleSender, recipient: possibleRecipient };
}


export function buildExplorerUrl(signature: string) {
    return `https://solscan.io/tx/${signature}`;
}
