import { describe, expect, it } from 'vitest';
import {
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  InsufficientFundsError,
  UserRejectedRequestError,
  encodeErrorResult,
  stringToHex,
  type Abi,
  type Hex,
} from 'viem';
import { decodeTxError } from './errors';
import { PaytagRegistryAbi } from './generated/PaytagRegistryAbi';
import { PaytagResolverAbi } from './generated/PaytagResolverAbi';

const NODE = ('0x' + '22'.repeat(32)) as Hex;
const ME = '0x6aD631F215393f9635231de985081B1ccDDC7C11';

/** The error viem actually throws when a simulated call reverts with a custom error. */
function reverted(abi: Abi, errorName: string, args: readonly unknown[], functionName: string) {
  const data = encodeErrorResult({ abi, errorName, args } as never);
  const cause = new ContractFunctionRevertedError({ abi, data, functionName });
  // Placeholder call args: viem only uses them to format the error's message.
  return new ContractFunctionExecutionError(cause, { abi, functionName, args: ['x', 'x', 'x'], contractAddress: ME });
}

const CASES: [string, Abi, readonly unknown[], string, RegExp][] = [
  ['InvalidLength', PaytagRegistryAbi as Abi, [2n], 'register', /3–20 characters \(this one is 2\)/],
  ['InvalidCharacter', PaytagRegistryAbi as Abi, [3n, stringToHex('-', { size: 1 })], 'register', /Character 4 \(-\) isn’t allowed/],
  ['InvalidCharacter', PaytagRegistryAbi as Abi, [0n, stringToHex(' ', { size: 1 })], 'register', /Character 1 \(space\)/],
  ['NonAsciiName', PaytagRegistryAbi as Abi, [1n], 'register', /Character 2 isn’t plain ASCII/],
  ['NameTaken', PaytagRegistryAbi as Abi, [NODE], 'register', /@derrick is already registered/],
  ['ReservedName', PaytagRegistryAbi as Abi, [NODE], 'register', /@derrick is reserved/],
  ['NotOwner', PaytagRegistryAbi as Abi, [NODE, ME], 'transfer', /Only the owner of @derrick/],
  ['ZeroAddress', PaytagRegistryAbi as Abi, [], 'transfer', /zero address/],
  ['NotOwner', PaytagResolverAbi as Abi, [NODE, ME], 'setRecord', /Only the owner of @derrick/],
  ['InvalidEthAddress', PaytagResolverAbi as Abi, [19n], 'setRecord', /exactly 20 bytes \(got 19\)/],
  ['ZeroEthAddress', PaytagResolverAbi as Abi, [], 'setRecord', /zero address can’t be used/],
  ['ReverseMismatch', PaytagResolverAbi as Abi, [NODE, ME], 'setReverse', /@derrick’s Ethereum record must point at your connected wallet/],
];

describe('decodeTxError: contract reverts', () => {
  it.each(CASES)('%s (%#)', (errorName, abi, args, fn, expected) => {
    const result = decodeTxError(reverted(abi, errorName, args, fn), { name: 'derrick' });
    expect(result.kind).toBe('revert');
    expect(result.errorName).toBe(errorName);
    expect(result.message).toMatch(expected);
    expect(result.message).not.toMatch(/0x[0-9a-f]{8}/i); // never raw hex
  });

  it('covers every custom error in both ABIs', () => {
    const declared = new Set(
      [...PaytagRegistryAbi, ...PaytagResolverAbi].filter((e) => e.type === 'error').map((e) => e.name),
    );
    const tested = new Set(CASES.map((c) => c[0]));
    expect([...declared].filter((n) => !tested.has(n))).toEqual([]);
  });

  it('falls back to a generic subject without a name', () => {
    const result = decodeTxError(reverted(PaytagRegistryAbi as Abi, 'NameTaken', [NODE], 'register'));
    expect(result.message).toBe('This name is already registered.');
  });
});

describe('decodeTxError: wallet and network', () => {
  it('recognises a wallet rejection', () => {
    const err = new UserRejectedRequestError(new Error('User rejected the request.'));
    expect(decodeTxError(err)).toEqual({ kind: 'rejected', message: 'Rejected in your wallet.' });
  });

  it('recognises EIP-1193 code 4001 anywhere in the chain', () => {
    expect(decodeTxError({ cause: { code: 4001 } }).kind).toBe('rejected');
  });

  it('recognises insufficient funds', () => {
    const err = new InsufficientFundsError({ cause: new BaseError('insufficient funds for gas * price + value') });
    expect(decodeTxError(err).kind).toBe('funds');
  });

  it('recognises a chain mismatch', () => {
    const err = new BaseError('The current chain of the wallet (id: 1) does not match the target chain');
    expect(decodeTxError(err).kind).toBe('network');
  });

  it('keeps short unknown messages and hides long ones', () => {
    expect(decodeTxError(new Error('nonce too low')).message).toBe('nonce too low');
    expect(decodeTxError(new Error('x'.repeat(500))).message).toBe('Something went wrong sending the transaction.');
  });
});
