import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { UiKit } from './UiKit';

export const metadata: Metadata = {
  title: 'UI kit · Paytag',
  robots: { index: false, follow: false },
};

// Internal review page for components/ui. Not linked anywhere; 404 in production.
export default function UiKitPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <UiKit />;
}
