// One-off: brings onchain_events up to date from the seeded cursor (the v0.2 deploy block), so no
// user request ever pays for a cold backfill. Safe to re-run: rows are idempotent and the cursor
// only moves forward. Uses the same sync as the API (lease included), with no per-request cap.
//
//   npx ts-node --transpile-only scripts/onchain-backfill.ts
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (from .env), and migration 0008 applied.
import 'dotenv/config';
import { env } from '../src/config/env';
import { catchUp, syncedBlock } from '../src/services/onchainEventsService';
import { readHead } from '../src/onchain/state';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Done once the cursor is within the reorg margin plus this many blocks of the head. The chain
 * keeps moving while a round runs, so "exactly current" is never reached; requests cover the rest.
 */
const SLACK_BLOCKS = 100n;

const main = async (): Promise<void> => {
  for (let round = 1; ; round++) {
    const result = await catchUp({ maxChunks: 1_000 });
    const cursor = await syncedBlock();
    const head = await readHead();
    console.log(`round ${round}: ${result.status}${'via' in result ? ` via ${result.via}` : ''}, cursor ${cursor}, head ${head}`);
    if (result.status === 'current' || head - cursor <= BigInt(env.ONCHAIN_CONFIRMATIONS) + SLACK_BLOCKS) break;
    // Pace the rounds: Blockscout rate-limits (429) a tight loop.
    await sleep(result.status === 'busy' ? 5_000 : 2_000);
  }
  console.log('onchain_events is current');
};

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
