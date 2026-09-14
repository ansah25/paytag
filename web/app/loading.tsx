import { Skeleton, SkeletonStatus } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <section aria-busy="true" className="mx-auto grid w-full max-w-content gap-7 px-6 pb-24 pt-14">
      <SkeletonStatus>Loading…</SkeletonStatus>
      <div className="flex items-center gap-4">
        <Skeleton shape="circle" className="h-16 w-16 shrink-0" />
        <div className="grid gap-2.5">
          <Skeleton className="h-10 w-[200px] max-w-[55vw]" />
          <Skeleton className="h-3.5 w-[140px]" delay={200} />
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
        <Skeleton shape="card" className="h-[260px]" delay={100} />
        <Skeleton shape="card" className="h-[260px]" delay={300} />
      </div>
    </section>
  );
}
