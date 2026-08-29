/**
 * Inline SVGs rather than an icon package: the set is small and fixed, and a
 * dependency here would ship several hundred unused glyphs to the browser.
 * All are 24x24, stroke-based, and inherit currentColor.
 */

type P = { className?: string };

const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Svg({ className, children }: P & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden {...S}>
      {children}
    </svg>
  );
}

/** The AI motif. Filled, because it reads as a mark rather than an outline. */
export function Sparkle({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M12 2c.3 3.9 2.3 6.4 6.2 7-3.9.6-5.9 3.1-6.2 7-.3-3.9-2.3-6.4-6.2-7 3.9-.6 5.9-3.1 6.2-7Z" />
    </svg>
  );
}

/** The loading cluster: one large star, one medium, two dots. */
export function SparkleCluster({ className }: P) {
  return (
    <svg viewBox="0 0 96 96" className={className} aria-hidden fill="currentColor">
      <path
        className="animate-twinkle"
        d="M62 16c.6 8.6 5 14.1 13.6 15.4C67 32.8 62.6 38.3 62 46.9c-.6-8.6-5-14.1-13.6-15.5C57 30.1 61.4 24.6 62 16Z"
      />
      <path
        className="animate-twinkle"
        style={{ animationDelay: "0.55s" }}
        d="M38 44c.4 6.4 3.7 10.5 10.1 11.5C41.7 56.5 38.4 60.6 38 67c-.4-6.4-3.7-10.5-10.1-11.5C34.3 54.5 37.6 50.4 38 44Z"
      />
      <circle className="animate-twinkle" style={{ animationDelay: "0.9s" }} cx="34" cy="30" r="3.2" />
      <circle className="animate-twinkle" style={{ animationDelay: "1.3s" }} cx="62" cy="60" r="2.4" />
    </svg>
  );
}

export const Home = ({ className }: P) => (
  <Svg className={className}>
    <path d="M3 10.2 12 3.5l9 6.7V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z" />
  </Svg>
);

export const Classroom = ({ className }: P) => (
  <Svg className={className}>
    <rect x="3" y="4" width="18" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </Svg>
);

export const Assignments = ({ className }: P) => (
  <Svg className={className}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </Svg>
);

export const Exams = ({ className }: P) => (
  <Svg className={className}>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1H9ZM9 11h6M9 15h4" />
  </Svg>
);

export const Library = ({ className }: P) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </Svg>
);

export const Settings = ({ className }: P) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
  </Svg>
);

export const PanelToggle = ({ className }: P) => (
  <Svg className={className}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </Svg>
);

export const ArrowLeft = ({ className }: P) => (
  <Svg className={className}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Svg>
);

export const ArrowRight = ({ className }: P) => (
  <Svg className={className}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

export const ChevronDown = ({ className }: P) => (
  <Svg className={className}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const ChevronLeft = ({ className }: P) => (
  <Svg className={className}>
    <path d="m15 18-6-6 6-6" />
  </Svg>
);

export const ChevronRight = ({ className }: P) => (
  <Svg className={className}>
    <path d="m9 18 6-6-6-6" />
  </Svg>
);

export const ChevronsRight = ({ className }: P) => (
  <Svg className={className}>
    <path d="m6 17 5-5-5-5M13 17l5-5-5-5" />
  </Svg>
);

/** Guide mode. A lamp rather than a question mark, so it reads as "show me"
 *  rather than "explain the product" — the Help control beside it is the second. */
export const Bulb = ({ className }: P) => (
  <Svg className={className}>
    <path d="M9.2 16.5a5.5 5.5 0 1 1 5.6 0v1.3a1.2 1.2 0 0 1-1.2 1.2h-3.2a1.2 1.2 0 0 1-1.2-1.2Z" />
    <path d="M10.2 21.2h3.6" />
  </Svg>
);

export const Help = ({ className }: P) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.4a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.3" />
    <circle cx="12" cy="17" r=".6" fill="currentColor" />
  </Svg>
);

export const Bell = ({ className }: P) => (
  <Svg className={className}>
    <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7M13.7 20a2 2 0 0 1-3.4 0" />
  </Svg>
);

export const Upload = ({ className }: P) => (
  <Svg className={className}>
    <path d="M12 15V3M8 7l4-4 4 4M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </Svg>
);

export const Close = ({ className }: P) => (
  <Svg className={className}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);

export const Plus = ({ className }: P) => (
  <Svg className={className}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const Minus = ({ className }: P) => (
  <Svg className={className}>
    <path d="M5 12h14" />
  </Svg>
);

export const Menu = ({ className }: P) => (
  <Svg className={className}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Svg>
);

export const Trash = ({ className }: P) => (
  <Svg className={className}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </Svg>
);

export const Clock = ({ className }: P) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);

export const Check = ({ className }: P) => (
  <Svg className={className}>
    <path d="M4 12.5l5 5L20 6.5" />
  </Svg>
);

export const Undo = ({ className }: P) => (
  <Svg className={className}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </Svg>
);

export const Search = ({ className }: P) => (
  <Svg className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="M16.5 16.5L21 21" />
  </Svg>
);

export const Download = ({ className }: P) => (
  <Svg className={className}>
    <path d="M12 4v11m0 0l-4-4m4 4l4-4" />
    <path d="M5 19h14" />
  </Svg>
);

/** The red PDF chit used on uploaded file rows. */
export function PdfMark({ className }: P) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="3" y="2" width="26" height="28" rx="3" fill="#FDECEA" />
      <path d="M20 2l9 9h-6a3 3 0 0 1-3-3V2Z" fill="#F7C9C3" />
      <rect x="1" y="14" width="24" height="12" rx="2.5" fill="#E23B2E" />
      <text
        x="13"
        y="22.6"
        textAnchor="middle"
        fontFamily="Figtree, system-ui, sans-serif"
        fontSize="7.4"
        fontWeight="800"
        fill="#fff"
      >
        PDF
      </text>
    </svg>
  );
}

/** Placeholder school crest — the design shows one, we have no asset. */
export function Crest({ className }: P) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="16" cy="16" r="15" fill="#E8F7EE" stroke="#16A34A" strokeWidth="1.2" />
      <path
        d="M16 7l7 3.5v6c0 4.4-3 7.7-7 8.9-4-1.2-7-4.5-7-8.9v-6L16 7Z"
        fill="#16A34A"
        opacity=".85"
      />
      <path d="M12.5 16.2l2.4 2.4 4.6-4.8" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
