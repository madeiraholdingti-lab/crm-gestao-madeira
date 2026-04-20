/**
 * Marca oficial do Maikonect — Madeira Holding
 * Design system: quadrado navy com borda dourada + monograma "MM" estilizado
 * (duas linhas formando M de Maikon / M de Madeira) + pingo dourado.
 *
 * Cores tokenizadas via CSS vars — respeita theme/palette overrides.
 */
interface MHMarkProps {
  size?: number;
  bg?: string;
  fg?: string;
  className?: string;
}

export const MHMark = ({
  size = 32,
  bg = "hsl(var(--mh-navy-900))",
  fg = "hsl(var(--mh-gold-500))",
  className,
}: MHMarkProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    className={className}
    aria-label="Maikonect"
  >
    <rect x="2" y="2" width="60" height="60" rx="8" fill={bg} />
    <rect x="4" y="4" width="56" height="56" rx="6" fill="none" stroke={fg} strokeWidth="0.8" opacity="0.5" />
    <path
      d="M14 46 V18 L24 18 L32 32 L40 18 L50 18 V46"
      stroke={fg}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
    <circle cx="32" cy="50" r="1.3" fill={fg} />
  </svg>
);
