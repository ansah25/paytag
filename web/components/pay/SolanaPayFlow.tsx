'use client';

import { useSolanaPay } from '@/lib/pay/useSolanaPay';
import type { PayFlowProps } from '@/lib/pay/types';
import { PayFlow } from './PayFlow';

export default function SolanaPayFlow(props: PayFlowProps) {
  const adapter = useSolanaPay(props.recipient);
  return <PayFlow chain="solana" adapter={adapter} {...props} />;
}
