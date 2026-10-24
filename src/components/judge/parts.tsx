import { bandFor } from "@/lib/rubrics";
import { STATUS_META, type Status } from "@/lib/status";
import { tone } from "@/lib/tone";

/* Small pieces the judge console's tabs and sheet share. Styles: .jg-* in globals.css. */

type IconProps = { size?: number; strokeWidth?: number; children: React.ReactNode };

function Svg({ size = 18, strokeWidth = 1.9, children }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const ChevronRight = () => (
  <Svg>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);
export const ChevronDown = () => (
  <Svg>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);
export const PlusIcon = () => (
  <Svg size={16} strokeWidth={2}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const CloseIcon = () => (
  <Svg size={20} strokeWidth={2}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
export const CheckIcon = () => (
  <Svg size={16} strokeWidth={2.2}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);
export const MessageIcon = () => (
  <Svg size={16}>
    <path d="M4 5h16v11H9l-5 4V5z" />
  </Svg>
);
export const TrophyIcon = () => (
  <Svg size={13} strokeWidth={2}>
    <path d="M8 4h8v6a4 4 0 0 1-8 0zM8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 14v3M8 20h8" />
  </Svg>
);
export const WarnIcon = () => (
  <Svg>
    <path d="M12 3.5l9.5 16.5h-19L12 3.5zM12 10v4.5M12 17.2v.01" />
  </Svg>
);

/** The status as a pill, filled in that status's colour (`.jg-s-<status>`). */
export function StatusPill({ status, short = false }: { status: Status; short?: boolean }) {
  const meta = STATUS_META[status];
  return <span className={`jg-sc jg-s-${status}`}>{short ? meta.short : meta.label}</span>;
}

/** A coloured status dot; the hollow one marks a section of teams with no status. */
export function Dot({ status }: { status?: Status }) {
  return <i className={status ? `jg-dot jg-s-${status}` : "jg-dot jg-hollow"} aria-hidden="true" />;
}

/** The score band, in the config's band colours. Nothing for an unscored team. */
export function BandPill({
  total,
  max,
  scored,
}: {
  total: number;
  max: number;
  scored: boolean;
}) {
  const band = bandFor(total, max, scored);
  if (!band) return null;
  return <span className={`jg-band ring-1 ring-inset ${tone(band.color)}`}>{band.label}</span>;
}
