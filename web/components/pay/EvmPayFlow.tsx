'use client';

import { useEvmPay } from '@/lib/pay/useEvmPay';
import type { PayFlowProps } from '@/lib/pay/types';
import { PayFlow } from './PayFlow';

export default function EvmPayFlow(props: PayFlowProps) {
  const adapter = useEvmPay(props.recipient);
  return <PayFlow chain="ethereum" adapter={adapter} {...props} />;
}
