import { eq } from "ponder";
import { ponder } from "ponder:registry";
import schema from "ponder:schema";
import { zeroAddress, zeroHash } from "viem";
import { decodeAddress } from "./lib/codec";
import { ordinal } from "./lib/resolve";

// Addresses are stored lowercase so equality checks and owner lookups are case-insensitive;
// the API checksums on the way out.

ponder.on("PaytagRegistry:NameRegistered", async ({ event, context }) => {
  const { node, name, owner } = event.args;
  await context.db.insert(schema.names).values({
    node,
    name,
    owner: owner.toLowerCase() as `0x${string}`,
    registeredBlock: event.block.number,
    registeredAt: event.block.timestamp,
    epoch: 0n,
    lastTransferAt: null,
  });
});

ponder.on("PaytagRegistry:Transfer", async ({ event, context }) => {
  const { node, from, to } = event.args;
  await context.db.insert(schema.transfers).values({
    id: event.id,
    node,
    from: from.toLowerCase() as `0x${string}`,
    to: to.toLowerCase() as `0x${string}`,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
  });

  // The mint Transfer (from 0x0) directly follows NameRegistered in the same tx; the name row
  // already reflects it. A self-transfer changes nothing. A real change of owner starts a new
  // epoch on-chain, which makes every earlier record unreachable, so the read model drops them
  // (reverse claims resting on the old ETH record go dark with it).
  if (from === zeroAddress || from.toLowerCase() === to.toLowerCase()) return;
  await context.db.update(schema.names, { node }).set((row) => ({
    owner: to.toLowerCase() as `0x${string}`,
    epoch: row.epoch + 1n,
    lastTransferAt: event.block.timestamp,
  }));
  await context.db.sql.delete(schema.records).where(eq(schema.records.node, node));
});

ponder.on("PaytagResolver:RecordSet", async ({ event, context }) => {
  const { node, coinType, addr } = event.args;

  // Empty bytes clear the record on-chain; mirror that by removing the row.
  if (addr === "0x") {
    await context.db.delete(schema.records, { node, coinType });
    return;
  }

  const row = {
    value: addr,
    address: decodeAddress(coinType, addr),
    updatedOrdinal: ordinal(event.block.number, event.log.logIndex),
    updatedBlock: event.block.number,
  };
  await context.db
    .insert(schema.records)
    .values({ node, coinType, ...row })
    .onConflictDoUpdate(row);
});

ponder.on("PaytagResolver:ReverseSet", async ({ event, context }) => {
  const { account, node } = event.args;
  const key = account.toLowerCase() as `0x${string}`;

  if (node === zeroHash) {
    await context.db.delete(schema.reverseClaims, { account: key });
    return;
  }
  await context.db
    .insert(schema.reverseClaims)
    .values({ account: key, node, updatedBlock: event.block.number })
    .onConflictDoUpdate({ node, updatedBlock: event.block.number });
});
