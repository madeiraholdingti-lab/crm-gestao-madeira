import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Empty state institucional — ícone em caixa dourada, título serif, descrição
 * em cinza e CTA primário. Substitui os "Nenhum resultado" soltos espalhados.
 * Identidade Madeira Holding: caixa dourada dá peso de "feature disponível",
 * serif dá tom de proposta (não mensagem de erro).
 */
interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: LucideIcon;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  tone?: "gold" | "navy" | "teal" | "muted";
  className?: string;
  children?: ReactNode;
}

const TONE_STYLES = {
  gold:  { box: "bg-mh-gold-100 border-mh-gold-300/40", icon: "text-mh-gold-700" },
  navy:  { box: "bg-mh-navy-100 border-mh-navy-700/20", icon: "text-mh-navy-700" },
  teal:  { box: "bg-mh-teal-500/10 border-mh-teal-500/20", icon: "text-mh-teal-700" },
  muted: { box: "bg-muted border-border",              icon: "text-mh-ink-3" },
} as const;

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  tone = "gold",
  className,
  children,
}: EmptyStateProps) {
  const styles = TONE_STYLES[tone];

  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-12 px-4", className)}>
      {Icon && (
        <div className={cn("w-16 h-16 rounded-2xl flex items-center justify-center border mb-5", styles.box)}>
          <Icon className={cn("h-7 w-7", styles.icon)} strokeWidth={1.5} />
        </div>
      )}
      <h3 className="font-serif-display text-xl font-medium text-mh-ink mb-1.5 leading-tight">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-mh-ink-3 max-w-md leading-relaxed">
          {description}
        </p>
      )}
      {children && <div className="mt-5 w-full max-w-md">{children}</div>}
      {(action || secondaryAction) && (
        <div className="flex flex-wrap gap-2 justify-center mt-6">
          {action && (
            <Button onClick={action.onClick} className="gap-2">
              {action.icon && <action.icon className="h-4 w-4" />}
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button variant="outline" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
