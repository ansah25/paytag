// Read-only: checks every saved address against the current validators.
//
//   npm run sdk:build && npx ts-node --transpile-only supabase/ops/address_check.ts
//
// Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env and only SELECTs. Run it whenever
// address validation gets stricter: rows saved under older, looser rules stay in the table.
//   SDK  the row fails @paytagdev/sdk's checks, so every resolve of that user fails with
//        INVALID_RESPONSE (their pay page and dashboard break). Must be fixed before release.
//   API  the row fails the API's own (stricter) checks: it still resolves, but couldn't be
//        saved today.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { isBitcoinAddress, isEthereumAddress, isSolanaAddress } from '../../src/utils/addresses';
import { isValidAddress } from '@paytagdev/sdk';

type Chain = 'ethereum' | 'solana' | 'bitcoin';
const API_CHECK: Record<Chain, (a: string) => boolean> = {
  ethereum: isEthereumAddress,
  solana: isSolanaAddress,
  bitcoin: isBitcoinAddress,
};
const PAGE = 1000;

const main = async (): Promise<void> => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  let checked = 0;
  let sdkFailures = 0;
  let apiFailures = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('wallet_mappings')
      .select('id, chain, address, users(username)')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      checked++;
      const user = (row.users as { username?: string } | null)?.username ?? '?';
      const chain = row.chain as Chain;
      if (!(chain in API_CHECK)) continue; // unsupported chains are never resolved
      const address = String(row.address);
      const sdkOk = isValidAddress(chain, address);
      const apiOk = API_CHECK[chain](address);
      if (!sdkOk) sdkFailures++;
      if (!apiOk) apiFailures++;
      if (!sdkOk || !apiOk) {
        console.log(`${sdkOk ? 'API' : 'SDK'}  @${user}  ${chain}  ${address}  (mapping ${row.id})`);
      }
    }
    if (!data || data.length < PAGE) break;
  }
  console.log(`\nchecked ${checked} rows: ${sdkFailures} fail the SDK, ${apiFailures} fail the API`);
  if (sdkFailures > 0) process.exitCode = 1;
};

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 2;
});
