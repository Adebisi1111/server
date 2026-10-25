/**
 * Shared helper: resolve Arc Testnet RPC URLs for server-side use.
 *
 * The provisioned Arc Studio proxy is preferred when a token is configured;
 * otherwise (and as a fallback) we use public endpoints. `rpc.testnet.arc.io`
 * is the canonical public endpoint; thirdweb sends `Access-Control-Allow-Origin: *`.
 */
export function arcTestnetRpcUrls(): string[] {
  const base = process.env.RPC_PROXY_BASE_URL
  const token = process.env.RPC_PROXY_TOKEN
  const chains = (process.env.RPC_PROXY_CHAINS ?? '').split(',').map((s) => s.trim())
  const urls: string[] = []
  if (base && token && chains.includes('Arc_Testnet')) {
    urls.push(`${base}/api/rpc/Arc_Testnet?_rpc_token=${token}`)
  }
  urls.push('https://rpc.testnet.arc.io')
  urls.push('https://arc-testnet.rpc.thirdweb.com')
  return urls
}

export function arcTestnetRpcUrl(): string {
  return arcTestnetRpcUrls()[0]
}
