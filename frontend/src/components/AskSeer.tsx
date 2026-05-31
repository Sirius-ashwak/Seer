import { useEffect, useMemo, useRef, useState } from "react";
import { SendHorizonal, Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { usePortfolio } from "@/hooks/usePortfolio";
import { loadActivity } from "@/lib/activity";
import {
  answer,
  buildSuggestions,
  type Answer,
  type AnswerBlock,
  type AskContext,
  type GlanceBar,
  type Suggestion,
} from "@/lib/askSeer";
import { cn } from "@/lib/utils";
import type { MarketSummary } from "@/types";

interface AskSeerProps {
  open: boolean;
  onClose: () => void;
  markets: MarketSummary[];
  account: string | null;
}

type Turn = { role: "user"; text: string } | { role: "assistant"; answer: Answer };

const GREETING: Answer = {
  blocks: [
    {
      kind: "text",
      text: "I'm SEER's assistant. I read the live markets, your positions, and the bonded oracle — pick a question below and I'll pull the real numbers.",
    },
  ],
};

// "Where markets stand" — diverging bars centered on a 50/50 coin-flip. Green =
// YES-favored, red = NO-favored. Fed real current odds (no fabricated 24h move).
function DivergingBars({ bars }: { bars: GlanceBar[] }) {
  const max = Math.max(1, ...bars.map((b) => Math.abs(b.v)));
  return (
    <div className="flex flex-col gap-2.5">
      {bars.map((b) => (
        <div key={b.address} className="flex items-center gap-3 text-xs">
          <div className="w-28 shrink-0 truncate text-muted">{b.label}</div>
          <div className="relative flex h-4 flex-1 items-center">
            <div className="absolute left-1/2 top-0 h-full w-px bg-line-strong" />
            <div className="flex h-full w-1/2 items-center justify-end pr-px">
              {b.v < 0 && (
                <div className="h-2.5 rounded-l-sm bg-no" style={{ width: `${(Math.abs(b.v) / max) * 100}%` }} />
              )}
            </div>
            <div className="flex h-full w-1/2 items-center justify-start pl-px">
              {b.v > 0 && (
                <div className="h-2.5 rounded-r-sm bg-yes" style={{ width: `${(b.v / max) * 100}%` }} />
              )}
            </div>
          </div>
          <div className={cn("tnum w-14 text-right", b.v >= 0 ? "text-yes" : "text-no")}>
            {(50 + b.v).toFixed(0)}%
          </div>
        </div>
      ))}
    </div>
  );
}

function Block({ block }: { block: AnswerBlock }) {
  switch (block.kind) {
    case "heading":
      return <div className="font-hero text-lg text-ink">{block.text}</div>;
    case "text":
      return <p className="text-[15px] leading-relaxed text-ink">{block.text}</p>;
    case "note":
      return <p className="text-xs leading-relaxed text-faint">{block.text}</p>;
    case "bullets":
      return (
        <ul className="space-y-2 text-[15px] leading-relaxed text-muted">
          {block.items.map((it, i) => (
            <li key={i}>
              {it.label && <span className="text-ink">{it.label} </span>}
              {it.text}
            </li>
          ))}
        </ul>
      );
    case "glance":
      return (
        <div className="rounded-[var(--radius-card)] border border-line bg-canvas/40 p-4">
          <div className="font-hero text-sm text-ink">{block.title}</div>
          <div className="mb-3 text-xs text-faint">{block.sub}</div>
          <DivergingBars bars={block.bars} />
        </div>
      );
  }
}

function AssistantTurn({ answer: a }: { answer: Answer }) {
  return (
    <div className="max-w-[88%] space-y-4">
      {a.blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  );
}

export function AskSeer({ open, onClose, markets, account }: AskSeerProps) {
  const { positions } = usePortfolio(account);
  const [turns, setTurns] = useState<Turn[]>([{ role: "assistant", answer: GREETING }]);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const ctx: AskContext = useMemo(
    () => ({ markets, positions, activity: loadActivity(account), account }),
    [markets, positions, account],
  );
  const suggestions = useMemo(() => buildSuggestions(ctx), [ctx]);

  // Reset the conversation each time the assistant is opened.
  useEffect(() => {
    if (open) {
      setTurns([{ role: "assistant", answer: GREETING }]);
      setDraft("");
    }
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const ask = (s: Suggestion) => {
    setTurns((t) => [
      ...t,
      { role: "user", text: s.label },
      { role: "assistant", answer: answer(ctx, s.intent, s.market) },
    ]);
  };

  const submitFreeText = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    // No LLM — free text routes to the fallback that re-surfaces the chips.
    setTurns((t) => [...t, { role: "user", text }, { role: "assistant", answer: answer(ctx, "fallback") }]);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      widthClassName="max-w-3xl"
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles className="size-4 text-accent" />
          Ask SEER
        </span>
      }
      description="Scripted answers, real data — no positions are taken on your behalf."
      footer={
        <div className="flex w-full flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s.label}
                onClick={() => ask(s)}
                className="rounded-full border border-line bg-panel-2 px-3 py-1.5 text-[13px] text-muted transition-colors hover:border-line-strong hover:text-ink"
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-panel-2 px-3 py-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitFreeText()}
              placeholder="Ask anything, or tap a suggestion…"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-faint focus:outline-none"
            />
            <button
              onClick={submitFreeText}
              aria-label="Send"
              className="grid size-8 place-items-center rounded-[var(--radius-control)] bg-primary text-canvas transition-[filter] hover:brightness-110"
            >
              <SendHorizonal className="size-4" />
            </button>
          </div>
          <p className="text-center text-xs text-faint">
            Not financial advice · play-money SEER Points
          </p>
        </div>
      }
    >
      <div ref={scrollRef} className="flex max-h-[52vh] flex-col gap-5 py-4">
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-panel-2 px-4 py-2.5 text-sm text-ink">
                {t.text}
              </div>
            </div>
          ) : (
            <AssistantTurn key={i} answer={t.answer} />
          ),
        )}
      </div>
    </Modal>
  );
}
