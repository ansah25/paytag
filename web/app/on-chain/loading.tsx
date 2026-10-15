import { Skeleton, SkeletonStatus } from '@/components/ui/Skeleton';

/** Shaped like the on-chain pages (title, intro, a panel or two) rather than the root profile skeleton. */
export default function OnchainLoading() {
  return (
    <section aria-busy="true" className="mx-auto grid w-full max-w-content gap-7 px-6 pb-24 pt-12">
      <SkeletonStatus>Loading…</SkeletonStatus>
      <div className="grid gap-3">
        <Skeleton className="h-12 w-[320px] max-w-[80vw]" />
        <Skeleton className="h-4 w-[520px] max-w-full" delay={150} />
      </div>
      <Skeleton shape="card" className="h-[220px]" delay={100} />
      <Skeleton shape="card" className="h-[160px]" delay={250} />
    </section>
  );
}
