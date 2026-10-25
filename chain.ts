/**
 * Server-side on-chain read: check if a reader has unlocked a docId.
 * Used by the gated file-download endpoint so the file path never
 * reaches the browser until the on-chain unlock is confirmed.
 */
import { createPublicClient, http } from 'viem'
import { CONTENT_PAYWALL_ABI } from './paywall-abi'
import { arcTestnetRpcUrl } from './rpc-url'

const ARC_TESTNET_CHAIN_ID = 5042002 // arc-studio-allow-onchain-literal

const rpcUrl = arcTestnetRpcUrl()

// Contract address from env (same VITE_ key the frontend uses)
const PAYWALL_ADDRESS = process.env.VITE_CONTENT_PAYWALL_ADDRESS as `0x${string}` | undefined

const publicClient = createPublicClient({
  chain: {
    id: ARC_TESTNET_CHAIN_ID,
    name: 'Arc Testnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  },
  transport: http(rpcUrl),
})

export async function checkOnchainUnlock(docId: number, reader: string): Promise<boolean> {
  if (!PAYWALL_ADDRESS) {
    console.error('VITE_CONTENT_PAYWALL_ADDRESS is not set in .env')
    return false
  }
  try {
    const result = await publicClient.readContract({
      address: PAYWALL_ADDRESS,
      abi: CONTENT_PAYWALL_ABI,
      functionName: 'isUnlocked',
      args: [BigInt(docId), reader as `0x${string}`],
    })
    return Boolean(result)
  } catch (err) {
    console.error('checkOnchainUnlock error:', err)
    return false
  }
}
