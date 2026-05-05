export const SUPPORTED_CHAINS = ['ethereum', 'solana', 'bitcoin'] as const;

export type ChainId = (typeof SUPPORTED_CHAINS)[number];

export interface ResolveResponse {
  username: string;
  addresses: Partial<Record<ChainId, string>>;
}

export type UnavailableReason = 'TAKEN' | 'INVALID_FORMAT' | 'RESERVED';

export interface AvailabilityResponse {
  available: boolean;
  reason?: UnavailableReason;
  suggestions: string[];
}

export const DEFAULT_BASE_URL = 'https://api.paytag.dev';
