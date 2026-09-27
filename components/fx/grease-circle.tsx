import { cn } from "@/lib/utils";

/**
 * A grease-pencil ring drawn around an approved frame, as on a photographer's contact sheet.
 * It stretches to the frame; the stroke keeps its width.
 */
export function GreaseCircle({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 200"
      preserveAspectRatio="none"
      aria-hidden
      fill="none"
      className={cn("pointer-events-none text-(--grease)", className)}
    >
      <path
        className="grease-path"
        pathLength={1}
        d="M104 10 C 160 8, 194 52, 191 102 C 188 156, 146 192, 98 190 C 46 188, 8 150, 10 98 C 12 50, 52 14, 108 13 C 136 13, 158 22, 170 32"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
