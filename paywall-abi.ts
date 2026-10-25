// Shared ABI for server-side on-chain reads (no import.meta.env here)
export const CONTENT_PAYWALL_ABI = [
  {
    name: 'isUnlocked',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'docId', type: 'uint256' },
      { name: 'reader', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const
