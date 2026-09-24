import { Skeleton } from "@/components/ui/controls";

export default function StudioLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-12 w-2/3 max-w-xl" />
        <Skeleton className="h-4 w-1/2 max-w-md" />
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="aspect-[4/5] rounded-(--radius-glass)" />
        ))}
      </div>
    </div>
  );
}
