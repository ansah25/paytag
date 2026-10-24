import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  type Hex,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  getAbiItem,
  multicall3Abi,
  zeroAddress,
  zeroHash,
} from 'viem';
import { REGISTRY_ADDRESS, RESOLVER_ADDRESS } from '../../src/onchain/deployment';
import { PaytagRegistryAbi } from '../../src/onchain/generated/PaytagRegistryAbi';
import { PaytagResolverAbi } from '../../src/onchain/generated/PaytagResolverAbi';
import { MULTICALL3, MULTICALL3_BLOCK_ABI } from '../../src/onchain/state';

// A fake Base Sepolia (JSON-RPC) and Blockscout, on one local HTTP server, plus an in-memory
// stand-in for the two Supabase tables. Enough of each to exercise the on-chain services for real:
// viem builds and decodes the actual multicall and log payloads.

export interface FakeName {
  owner: Hex;
  epoch: bigint;
  records: Map<bigint, Hex>; // coinType -> bytes (ETH: 20 bytes)
}

export interface FakeLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hex;
}

const hex = (n: bigint | number) => `0x${BigInt(n).toString(16)}` as Hex;
const txHash = (block: bigint, index: number) =>
  `0x${block.toString(16).padStart(32, '0')}${index.toString(16).padStart(32, '0')}` as Hex;

export const timestampOf = (block: bigint) => 1_790_000_000 + Number(block % 1_000_000n) * 2;

export class FakeChain {
  head = 49_000_000n;
  names = new Map<string, FakeName>(); // node -> state
  reverse = new Map<string, Hex>(); // account -> node
  logs: FakeLog[] = [];
  /** JSON-RPC method -> calls, for asserting batching and cost. */
  calls = new Map<string, number>();
  getLogsRanges: [bigint, bigint][] = [];
  blockscoutCalls = 0;
  rpcDown = false;
  blockscoutDown = false;
  /** Blockscout's indexed head; defaults to the chain head. */
  blockscoutHead: bigint | null = null;
  /** Report this head from Multicall3.getBlockNumber (a lagging node), when set. */
  multicallBlock: bigint | null = null;
  getLogsLimit = 200n;
  /** Delay every JSON-RPC answer by this long. */
  delayMs = 0;
  url = '';
  private server: Server | null = null;

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const send = (status: number, payload: unknown) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(payload));
        };
        if (req.method === 'GET') return this.blockscout(req.url ?? '', send);
        this.count('http');
        if (this.rpcDown) return send(503, { error: 'down' });
        const msg = JSON.parse(body) as { id: number; method: string; params: unknown[] } | unknown[];
        if (Array.isArray(msg)) return send(400, { error: 'no batches' });
        const answer = () => {
          try {
            send(200, { jsonrpc: '2.0', id: msg.id, result: this.rpc(msg.method, msg.params) });
          } catch (err) {
            const e = err as { code?: number; message: string };
            send(200, { jsonrpc: '2.0', id: msg.id, error: { code: e.code ?? -32000, message: e.message } });
          }
        };
        if (this.delayMs > 0) setTimeout(answer, this.delayMs);
        else answer();
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
    return this.url;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  reset(): void {
    this.head = 49_000_000n;
    this.names.clear();
    this.reverse.clear();
    this.logs = [];
    this.calls.clear();
    this.getLogsRanges = [];
    this.blockscoutCalls = 0;
    this.rpcDown = false;
    this.blockscoutDown = false;
    this.blockscoutHead = null;
    this.multicallBlock = null;
    this.delayMs = 0;
  }

  count(method: string): number {
    return this.calls.get(method) ?? 0;
  }

  // --- Scenario helpers: state and the events that produced it -------------------------------

  register(node: Hex, name: string, owner: Hex, block: bigint): void {
    this.names.set(node.toLowerCase(), { owner: owner.toLowerCase() as Hex, epoch: 0n, records: new Map() });
    this.emit(REGISTRY_ADDRESS, 'NameRegistered', { node, name, owner }, block);
    this.emit(REGISTRY_ADDRESS, 'Transfer', { node, from: zeroAddress, to: owner }, block);
  }

  transfer(node: Hex, to: Hex, block: bigint): void {
    const n = this.names.get(node.toLowerCase())!;
    const from = n.owner;
    n.owner = to.toLowerCase() as Hex;
    n.epoch += 1n;
    n.records.clear();
    this.emit(REGISTRY_ADDRESS, 'Transfer', { node, from, to }, block);
  }

  setRecord(node: Hex, coinType: bigint, value: Hex, block: bigint): void {
    const n = this.names.get(node.toLowerCase())!;
    if (value === '0x') n.records.delete(coinType);
    else n.records.set(coinType, value.toLowerCase() as Hex);
    this.emit(RESOLVER_ADDRESS, 'RecordSet', { node, coinType, addr: value }, block);
  }

  private emit(address: string, event: 'NameRegistered' | 'Transfer' | 'RecordSet', args: Record<string, unknown>, block: bigint): void {
    const abi = event === 'RecordSet' ? PaytagResolverAbi : PaytagRegistryAbi;
    const item = getAbiItem({ abi, name: event }) as { inputs: readonly { name: string; type: string; indexed?: boolean }[] };
    const topics = encodeEventTopics({ abi, eventName: event, args } as never) as Hex[];
    const plain = item.inputs.filter((i) => !i.indexed);
    const data = encodeAbiParameters(plain as never, plain.map((i) => args[i.name]) as never);
    const logIndex = this.logs.filter((l) => l.blockNumber === block).length;
    this.logs.push({ address: address.toLowerCase() as Hex, topics, data, blockNumber: block, logIndex, transactionHash: txHash(block, logIndex) });
  }

  // --- JSON-RPC ---------------------------------------------------------------------------------

  private rpc(method: string, params: unknown[]): unknown {
    this.calls.set(method, this.count(method) + 1);
    switch (method) {
      case 'eth_blockNumber':
        return hex(this.head);
      case 'eth_chainId':
        return hex(84532);
      case 'eth_call':
        return this.call((params[0] as { to: string; data: Hex }).to, (params[0] as { data: Hex }).data);
      case 'eth_getLogs':
        return this.getLogs(params[0] as { address: string[]; fromBlock: Hex; toBlock: Hex });
      case 'eth_getBlockByNumber': {
        const n = BigInt(params[0] as string);
        return {
          number: hex(n),
          hash: `0x${n.toString(16).padStart(64, '0')}`,
          parentHash: zeroHash,
          timestamp: hex(timestampOf(n)),
          nonce: '0x0000000000000000',
          difficulty: '0x0',
          gasLimit: '0x0',
          gasUsed: '0x0',
          miner: zeroAddress,
          extraData: '0x',
          logsBloom: `0x${'0'.repeat(512)}`,
          transactionsRoot: zeroHash,
          stateRoot: zeroHash,
          receiptsRoot: zeroHash,
          sha3Uncles: zeroHash,
          size: '0x0',
          totalDifficulty: '0x0',
          transactions: [],
          uncles: [],
        };
      }
      default:
        throw Object.assign(new Error(`unsupported ${method}`), { code: -32601 });
    }
  }

  private call(to: string, data: Hex): Hex {
    if (to.toLowerCase() !== MULTICALL3.toLowerCase()) throw new Error('only multicall');
    const { args } = decodeFunctionData({ abi: multicall3Abi, data });
    const calls = args[0] as readonly { target: string; callData: Hex }[];
    const results = calls.map((c) => ({ success: true, returnData: this.inner(c.target.toLowerCase(), c.callData) }));
    return encodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', result: results });
  }

  private inner(target: string, callData: Hex): Hex {
    if (target === MULTICALL3.toLowerCase()) {
      return encodeFunctionResult({ abi: MULTICALL3_BLOCK_ABI, functionName: 'getBlockNumber', result: this.multicallBlock ?? this.head });
    }
    if (target === REGISTRY_ADDRESS.toLowerCase()) {
      const { functionName, args } = decodeFunctionData({ abi: PaytagRegistryAbi, data: callData });
      if (functionName !== 'ownerAndEpoch') throw new Error(`unexpected registry.${functionName}`);
      const n = this.names.get((args![0] as Hex).toLowerCase());
      return encodeFunctionResult({ abi: PaytagRegistryAbi, functionName, result: [n?.owner ?? zeroAddress, n?.epoch ?? 0n] } as never);
    }
    if (target === RESOLVER_ADDRESS.toLowerCase()) {
      const { functionName, args } = decodeFunctionData({ abi: PaytagResolverAbi, data: callData });
      if (functionName === 'addr') {
        const n = this.names.get((args![0] as Hex).toLowerCase());
        return encodeFunctionResult({ abi: PaytagResolverAbi, functionName, result: n?.records.get(args![1] as bigint) ?? '0x' } as never);
      }
      if (functionName === 'reverse') {
        const account = (args![0] as Hex).toLowerCase();
        const node = this.reverse.get(account);
        // As PaytagResolver.reverse: live only while the node's ETH record is still the account.
        const live = node && this.names.get(node)?.records.get(60n)?.toLowerCase() === account;
        return encodeFunctionResult({ abi: PaytagResolverAbi, functionName, result: live ? node : zeroHash } as never);
      }
    }
    throw new Error(`unexpected call to ${target}`);
  }

  private getLogs(filter: { address: string[] | string; fromBlock: Hex; toBlock: Hex }): unknown[] {
    const from = BigInt(filter.fromBlock);
    const to = BigInt(filter.toBlock);
    this.getLogsRanges.push([from, to]);
    if (to - from + 1n > this.getLogsLimit) {
      throw Object.assign(new Error(`eth_getLogs is limited to a ${this.getLogsLimit} range`), { code: -32614 });
    }
    const addrs = (Array.isArray(filter.address) ? filter.address : [filter.address]).map((a) => a.toLowerCase());
    return this.logs
      .filter((l) => l.blockNumber >= from && l.blockNumber <= to && addrs.includes(l.address))
      .map((l) => ({
        address: l.address,
        topics: l.topics,
        data: l.data,
        blockNumber: hex(l.blockNumber),
        blockHash: `0x${l.blockNumber.toString(16).padStart(64, '0')}`,
        logIndex: hex(l.logIndex),
        transactionHash: l.transactionHash,
        transactionIndex: '0x0',
        removed: false,
      }));
  }

  // --- Blockscout -------------------------------------------------------------------------------

  private blockscout(path: string, send: (status: number, payload: unknown) => void): void {
    this.blockscoutCalls++;
    if (this.blockscoutDown) return send(502, { message: 'down' });
    const url = new URL(path, 'http://x');
    if (url.pathname === '/api/v2/blocks') {
      return send(200, { items: [{ height: Number(this.blockscoutHead ?? this.head) }] });
    }
    const from = BigInt(url.searchParams.get('fromBlock')!);
    const to = BigInt(url.searchParams.get('toBlock')!);
    const address = url.searchParams.get('address')!.toLowerCase();
    const found = this.logs.filter((l) => l.address === address && l.blockNumber >= from && l.blockNumber <= to);
    if (found.length === 0) return send(200, { status: '0', message: 'No logs found', result: [] });
    send(200, {
      status: '1',
      message: 'OK',
      result: found.map((l) => ({
        address: l.address,
        blockNumber: hex(l.blockNumber),
        data: l.data,
        logIndex: hex(l.logIndex),
        timeStamp: hex(timestampOf(l.blockNumber)),
        // Blockscout pads to four topics with nulls.
        topics: [...l.topics, null, null, null, null].slice(0, 4),
        transactionHash: l.transactionHash,
      })),
    });
  }
}

// --- Supabase (onchain_events + onchain_sync_state) -----------------------------------------------

type Row = Record<string, unknown>;

export class FakeDb {
  events = new Map<string, Row>(); // `${block}:${logIndex}`
  state = { last_synced_block: 48_167_394, lease_token: null as string | null, lease_until: -Infinity };
  /** Fail every call while true. */
  down = false;
  inserts = 0;

  reset(): void {
    this.events.clear();
    this.state = { last_synced_block: 48_167_394, lease_token: null, lease_until: -Infinity };
    this.down = false;
    this.inserts = 0;
  }

  client() {
    const db = this;
    const fail = () => ({ data: null, error: { message: 'database down' } });
    return {
      from(table: string) {
        const filters: ((r: Row) => boolean)[] = [];
        let cols: string[] | null = null;
        let limit = Infinity;
        const run = () => {
          if (db.down) return fail();
          const source = table === 'onchain_events' ? [...db.events.values()] : [db.state as unknown as Row];
          const rows = source.filter((r) => filters.every((f) => f(r))).slice(0, limit);
          const data = rows.map((r) => (cols ? Object.fromEntries(cols.map((c) => [c, r[c]])) : { ...r }));
          return { data, error: null };
        };
        const builder = {
          select(c: string) {
            cols = c.split(',').map((s) => s.trim());
            return builder;
          },
          eq(column: string, value: unknown) {
            filters.push((r) => String(r[column]) === String(value));
            return builder;
          },
          in(column: string, values: unknown[]) {
            filters.push((r) => values.map(String).includes(String(r[column])));
            return builder;
          },
          limit(n: number) {
            limit = n;
            return builder;
          },
          single() {
            const { data, error } = run();
            return Promise.resolve(error ? { data: null, error } : { data: data![0] ?? null, error: data![0] ? null : { message: 'no row' } });
          },
          upsert(rows: Row[], opts: { onConflict: string; ignoreDuplicates: boolean }) {
            if (db.down) return Promise.resolve(fail());
            if (opts.onConflict !== 'block_number,log_index' || !opts.ignoreDuplicates) throw new Error('unexpected upsert');
            db.inserts++;
            for (const r of rows) {
              const key = `${r.block_number}:${r.log_index}`;
              if (!db.events.has(key)) db.events.set(key, { ...r });
            }
            return Promise.resolve({ data: null, error: null });
          },
          then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
            return Promise.resolve(run()).then(resolve, reject);
          },
        };
        return builder;
      },
      // The three lease functions, with the same rules as 0008's SQL.
      async rpc(fn: string, args: Record<string, unknown>) {
        if (db.down) return fail();
        const now = Date.now();
        const s = db.state;
        const ms = (secs: unknown) => Math.min(Math.max(Number(secs), 1), 600) * 1000;
        if (fn === 'onchain_sync_try_lease') {
          if (s.lease_until < now || s.lease_token === args.p_token) {
            s.lease_token = args.p_token as string;
            s.lease_until = now + ms(args.p_seconds);
            return { data: s.last_synced_block, error: null };
          }
          return { data: null, error: null };
        }
        if (fn === 'onchain_sync_advance') {
          if (s.lease_token !== args.p_token || s.lease_until < now) return { data: null, error: null };
          s.last_synced_block = Math.max(s.last_synced_block, Number(args.p_block));
          s.lease_until = now + ms(args.p_seconds);
          return { data: true, error: null };
        }
        if (fn === 'onchain_sync_release') {
          if (s.lease_token === args.p_token) {
            s.lease_token = null;
            s.lease_until = -Infinity;
          }
          return { data: null, error: null };
        }
        throw new Error(`unexpected rpc ${fn}`);
      },
    };
  }
}
