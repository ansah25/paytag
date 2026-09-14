'use client';

import { useBitcoinPay } from '@/lib/pay/useBitcoinPay';
import type { PayFlowProps } from '@/lib/pay/types';
import { PayFlow } from './PayFlow';

export default function BitcoinPayFlow(props: PayFlowProps) {
  const adapter = useBitcoinPay(props.recipient);
  return <PayFlow chain="bitcoin" adapter={adapter} {...props} />;
}
