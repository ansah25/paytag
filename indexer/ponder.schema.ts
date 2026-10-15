import { index, onchainTable, primaryKey } from "ponder";

// Ordinals are `(blockNumber << 32) | logIndex`, a total order over events. `records.updatedOrdinal`
// records when a value was last written; a transfer to a different owner deletes the name's
// records (contracts v0.2 epochs), so every stored record belongs to the current owner.

/** One row per registered name. `owner` is current; `transfers` holds the history. */
export const names = onchainTable(
  "names",
  (t) => ({
    node: t.hex().primaryKey(),
    name: t.text().notNull(),
    owner: t.hex().notNull(),
    registeredBlock: t.bigint().notNull(),
    registeredAt: t.bigint().notNull(), // unix seconds
    epoch: t.bigint().notNull(), // transfers to a different owner, as in the registry
    lastTransferAt: t.bigint(), // unix seconds of the latest such transfer; null if none
  }),
  (table) => ({
    ownerIdx: index().on(table.owner),
    nameIdx: index().on(table.name),
  }),
);

/** Every Transfer event, including the mint (from = 0x0) emitted by register. */
export const transfers = onchainTable(
  "transfers",
  (t) => ({
    id: t.text().primaryKey(),
    node: t.hex().notNull(),
    from: t.hex().notNull(),
    to: t.hex().notNull(),
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    transactionHash: t.hex().notNull(),
  }),
  (table) => ({
    nodeIdx: index().on(table.node),
  }),
);

/**
 * Current record per (node, coinType). Clearing a record (empty value) deletes the row, so a row
 * exists exactly when the resolver's `addr` returns non-empty bytes.
 */
export const records = onchainTable(
  "records",
  (t) => ({
    node: t.hex().notNull(),
    coinType: t.bigint().notNull(),
    value: t.hex().notNull(),
    address: t.text(), // decoded display form; null when the bytes don't decode for the coin type
    updatedOrdinal: t.bigint().notNull(),
    updatedBlock: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.node, table.coinType] }),
  }),
);

/**
 * Raw reverse claims as emitted by ReverseSet. Validity is NOT stored: a claim is live only while
 * the claimed node's ETH record still equals the account, which the API checks at read time,
 * mirroring PaytagResolver.reverse().
 */
export const reverseClaims = onchainTable(
  "reverse_claims",
  (t) => ({
    account: t.hex().primaryKey(),
    node: t.hex().notNull(),
    updatedBlock: t.bigint().notNull(),
  }),
  (table) => ({
    nodeIdx: index().on(table.node),
  }),
);
