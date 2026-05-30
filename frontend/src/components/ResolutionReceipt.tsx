import { useState } from "react";
import {
  Receipt,
  Globe,
  Sparkles,
  Gavel,
  Swords,
  CheckCircle2,
  ChevronDown,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ResolverPhase, ResolverOutcome, RESOLVER_OUTCOME_LABELS } from "@/abi";
import { fmt, short, timeAgo, timeUntil } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Resolution } from "@/types";

type BadgeTone = "neutral" | "yes" | "no" | "invalid";

function outcomeTone(outcome: number): BadgeTone {
  if (outcome === ResolverOutcome.Yes) return "yes";
  if (outcome === ResolverOutcome.No) return "no";
  if (outcome === ResolverOutcome.Invalid) return "invalid";
  return "neutral";
}

function outcomeLabel(outcome: number): string {
  return RESOLVER_OUTCOME_LABELS[outcome] ?? "Pending";
}

interface Step {
  label: string;
  phase: number;
}

export function ResolutionReceipt({
  resolution,
  loading,
}: {
  resolution: Resolution | null;
  loading: boolean;
}) {
  // Most markets have no resolution record — stay invisible until one confirms,
  // so open markets don't flash a skeleton.
  if (loading || !resolution || !resolution.exists) return null;

  const r = resolution;
  const disputed = r.disputer !== "" && r.disputer !== "0x0000000000000000000000000000000000000000";
  const headlineOutcome = r.finalized ? r.finalOutcome : r.proposedOutcome;

  const steps: Step[] = [
    { label: "Sources", phase: ResolverPhase.AwaitingSources },
    { label: "Inference", phase: ResolverPhase.AwaitingInference },
    { label: "Challenge", phase: ResolverPhase.Challenge },
    ...(disputed ? [{ label: "Disputed", phase: ResolverPhase.Disputed }] : []),
    { label: "Finalized", phase: ResolverPhase.Finalized },
  ];

  return (
    <Card className="grid gap-5 p-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Receipt className="size-4 text-accent" />
          Resolution receipt
        </div>
        <div className="ml-auto flex items-center gap-2">
          {disputed && (
            <Badge tone="invalid">
              <Swords className="size-3" />
              Disputed
            </Badge>
          )}
          <Badge tone={outcomeTone(headlineOutcome)} dot>
            {r.finalized ? outcomeLabel(headlineOutcome) : `Proposed ${outcomeLabel(headlineOutcome)}`}
          </Badge>
        </div>
      </header>

      <PhaseTimeline steps={steps} current={r.phase} />

      <Section icon={<Globe className="size-3.5" />} title={`Sources · ${r.sourcesReceived}/${r.sources.length}`}>
        <div className="grid gap-2">
          {r.sources.map((s) => (
            <SourceRow key={s.index} index={s.index} requestId={s.requestId} data={s.data} />
          ))}
        </div>
      </Section>

      <Section icon={<Sparkles className="size-3.5" />} title="LLM inference">
        <Field label="Request" value={r.llmRequestId > 0n ? `#${r.llmRequestId.toString()}` : "—"} mono />
        {r.inferencePrompt && <Quote label="Prompt" text={r.inferencePrompt} />}
        {r.llmRawResponse && <Quote label="Raw verdict" text={r.llmRawResponse} />}
      </Section>

      <Section icon={<Gavel className="size-3.5" />} title="Proposal">
        <Field label="Proposer" value={r.proposer ? short(r.proposer) : "—"} mono />
        <Field label="Bond" value={`${fmt(r.bond)} Points`} />
        {r.proposedAt > 0 && <Field label="Proposed" value={timeAgo(r.proposedAt)} />}
        {!r.finalized && r.challengeDeadline > 0 && (
          <Field
            label="Challenge window"
            value={
              r.challengeDeadline * 1000 > Date.now()
                ? `closes in ${timeUntil(r.challengeDeadline)}`
                : "closed — finalizable"
            }
          />
        )}
      </Section>

      {disputed && (
        <Section icon={<Swords className="size-3.5" />} title="Dispute">
          <Field label="Disputer" value={short(r.disputer)} mono />
          <Field label="Matched bond" value={`${fmt(r.disputerBond)} Points`} />
          {r.escalationRequestId > 0n && (
            <Field label="Escalation request" value={`#${r.escalationRequestId.toString()}`} mono />
          )}
        </Section>
      )}

      {r.finalized && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-4 text-xs text-faint">
          <span className="inline-flex items-center gap-1.5 text-muted">
            <CheckCircle2 className="size-3.5 text-yes" />
            Finalized {r.finalizedAt > 0 && timeAgo(r.finalizedAt)}
          </span>
          {disputed && r.protocolFeeBps > 0 && (
            <span>Protocol fee {(r.protocolFeeBps / 100).toFixed(2)}% of slashed bond</span>
          )}
        </div>
      )}
    </Card>
  );
}

function PhaseTimeline({ steps, current }: { steps: Step[]; current: number }) {
  return (
    <ol className="flex items-center gap-1">
      {steps.map((step, i) => {
        const done = current > step.phase;
        const active = current === step.phase;
        return (
          <li key={step.label} className="flex flex-1 items-center gap-1">
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full transition-colors",
                  done ? "bg-yes" : active ? "bg-accent" : "bg-line-strong",
                )}
              />
              <span
                className={cn(
                  "whitespace-nowrap text-[11px] font-medium",
                  done || active ? "text-ink" : "text-faint",
                )}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span className={cn("h-px flex-1", done ? "bg-yes/50" : "bg-line")} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-2 border-t border-line pt-4">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">
        {icon}
        {title}
      </div>
      <div className="grid gap-1.5">{children}</div>
    </section>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted">{label}</span>
      <span className={cn("text-right text-ink", mono && "font-mono text-xs")}>{value}</span>
    </div>
  );
}

function Quote({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 160;
  return (
    <div className="grid gap-1 text-sm">
      <span className="text-muted">{label}</span>
      <p
        className={cn(
          "whitespace-pre-wrap break-words rounded-[var(--radius-control)] bg-panel-2 p-2.5 font-mono text-xs leading-relaxed text-ink",
          !open && long && "line-clamp-3",
        )}
      >
        {text}
      </p>
      {long && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="justify-self-start text-xs text-accent transition-colors hover:text-ink"
        >
          {open ? "Show less" : "Show full"}
        </button>
      )}
    </div>
  );
}

function SourceRow({ index, requestId, data }: { index: number; requestId: bigint; data: string }) {
  const [open, setOpen] = useState(false);
  const hasData = data.length > 0;
  const long = data.length > 120;
  return (
    <div className="rounded-[var(--radius-control)] border border-line bg-panel-2 p-2.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono text-faint">#{index + 1}</span>
        <span className="text-muted">
          {requestId > 0n ? `request ${requestId.toString()}` : "no request"}
        </span>
        {hasData && long && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="ml-auto inline-flex items-center gap-0.5 text-accent transition-colors hover:text-ink"
          >
            {open ? "Less" : "More"}
            <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
          </button>
        )}
      </div>
      {hasData ? (
        <p
          className={cn(
            "mt-1.5 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-ink",
            !open && long && "line-clamp-2",
          )}
        >
          {data}
        </p>
      ) : (
        <p className="mt-1.5 text-xs text-faint">Awaiting callback…</p>
      )}
    </div>
  );
}
