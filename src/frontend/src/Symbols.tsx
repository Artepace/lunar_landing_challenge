import type { SVGProps } from "react";
const common = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;
// Lucide icons, ISC license: public/icons/LICENSE.
export function OrbitSymbol(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...common} {...props}>
      <path d="M20.341 6.484A10 10 0 0 1 10.266 21.85M3.659 17.516A10 10 0 0 1 13.74 2.152" />
      <circle cx="12" cy="12" r="3" />
      <circle cx="19" cy="5" r="2" />
      <circle cx="5" cy="19" r="2" />
    </svg>
  );
}
export function SurfaceSymbol(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...common} {...props}>
      <path d="m8 3 4 8 5-5 5 15H2L8 3z" />
    </svg>
  );
}

export function PlannerSymbol(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...common} {...props}>
      <rect x="4" y="5" width="16" height="16" rx="3" />
      <path d="M8 3v4m8-4v4M4 11h16m-12 5 2 2 5-4" />
    </svg>
  );
}
