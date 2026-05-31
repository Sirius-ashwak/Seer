import type { MarketSummary } from "@/types";
import type { PortfolioPosition } from "@/hooks/usePortfolio";
import type { ActivityEntry } from "@/lib/activity";
import { Outcome } from "@/abi";
import { fmt, pctNum } from "@/lib/format";

// Scripted, deterministic "Ask SEER" brain. No LLM, no backend, no API keys —
// every answer is computed from live on-chain reads (markets / positions /
// activity) so nothing it says is fabricated. Suggested-prompt chips map to the
// intents below; each returns structured blocks the UI renders.

export type AskIntent =
  | "glance"
  | "positions"
  | "claim"
  | "market"
  | "howResolution"
  | "howDispute"
  | "fallback";

// One market's standing for the diverging-bar viz: YES odds expressed as a
// signed deviation from a 50/50 coin-flip (green = YES-favored, red = NO).
export interface GlanceBar {
  label: string;
  address: string;
  v: number; // (YES% − 50), range −50..+50
}

export type AnswerBlock =
  | { kind: "text"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "bullets"; items: { label?: string; text: string }[] }
  | { kind: "glance"; title: string; sub: string; bars: GlanceBar[] }
  | { kind: "note"; text: string };

export interface Answer {
  blocks: AnswerBlock[];
}

export interface AskContext {
  markets: MarketSummary[];
  positions: PortfolioPosition[];
  activity: ActivityEntry[];
  account: string | null;
}

export interface Suggestion {
  label: string;
  intent: AskIntent;
  market?: string; // target address for the `market` intent
}

const DISCLAIMER = "Play-money SEER Points · educational, not financial advice.";

function truncate(s: string, n = 22): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// Open markets only, richest book first — used to pick a "headline" market.
function openByLiquidity(markets: MarketSummary[]): MarketSummary[] {
  return markets
    .filter((m) => m.outcome === Outcome.Pending)
    .sort((a, b) => Number(b.qYes + b.qNo - (a.qYes + a.qNo)));
}

export function headlineMarket(markets: MarketSummary[]): MarketSummary | null {
  return openByLiquidity(markets)[0] ?? null;
}

// Chips shown under the composer. The `market` chip names a real open market.
export function buildSuggestions(ctx: AskContext): Suggestion[] {
  const chips: Suggestion[] = [
    { label: "Where do markets stand?", intent: "glance" },
  ];
  const headline = headlineMarket(ctx.markets);
  if (headline) {
    chips.push({
      label: `Is YES on “${truncate(headline.question)}” rich?`,
      intent: "market",
      market: headline.address,
    });
  }
  if (ctx.account) {
    chips.push({ label: "How am I doing?", intent: "positions" });
    if (ctx.positions.some((p) => p.claimable)) {
      chips.push({ label: "What can I claim?", intent: "claim" });
    }
  }
  chips.push({ label: "How does resolution work?", intent: "howResolution" });
  chips.push({ label: "How does a dispute work?", intent: "howDispute" });
  return chips;
}

function glanceBars(markets: MarketSummary[]): GlanceBar[] {
  return markets
    .filter((m) => m.outcome === Outcome.Pending)
    .map((m) => ({
      label: truncate(m.question, 26),
      address: m.address,
      v: pctNum(m.priceYes) - 50,
    }))
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    .slice(0, 6);
}

function answerGlance(ctx: AskContext): Answer {
  const bars = glanceBars(ctx.markets);
  if (bars.length === 0) {
    return {
      blocks: [{ kind: "text", text: "No open markets are trading right now." }],
    };
  }
  return {
    blocks: [
      {
        kind: "text",
        text: "Here's where every open market stands right now — current YES odds, shown as the gap from an even 50/50. Green leans YES, red leans NO.",
      },
      {
        kind: "glance",
        title: "Where markets stand",
        sub: "Current YES odds vs. 50/50 · live on-chain prices",
        bars,
      },
      {
        kind: "note",
        text: "These are live LS-LMSR prices, not a 24h move — SEER keeps no price history off-chain.",
      },
    ],
  };
}

function answerPositions(ctx: AskContext): Answer {
  if (!ctx.account) {
    return { blocks: [{ kind: "text", text: "Connect a wallet and I'll summarize your positions." }] };
  }
  if (ctx.positions.length === 0) {
    return {
      blocks: [
        { kind: "text", text: "You don't hold any positions yet. Buy YES or NO in a market and it'll show up here." },
      ],
    };
  }
  const open = ctx.positions.filter((p) => p.outcome === Outcome.Pending);
  const claimable = ctx.positions.filter((p) => p.claimable);
  const totalValue = ctx.positions.reduce((s, p) => s + p.value, 0n);
  const claimableValue = claimable.reduce((s, p) => s + p.claimAmount, 0n);

  const items: { label?: string; text: string }[] = [
    { label: "Marked value:", text: `${fmt(totalValue)} Points across ${ctx.positions.length} market${ctx.positions.length === 1 ? "" : "s"}.` },
    { label: "Open:", text: `${open.length} position${open.length === 1 ? "" : "s"} still trading.` },
  ];
  if (claimable.length > 0) {
    items.push({
      label: "Claimable:",
      text: `${fmt(claimableValue)} Points from ${claimable.length} resolved market${claimable.length === 1 ? "" : "s"} — ask "what can I claim?".`,
    });
  }
  return {
    blocks: [
      { kind: "text", text: "Here's your book, marked at current prices:" },
      { kind: "bullets", items },
      { kind: "note", text: "Open positions are marked at the marginal LMSR price; resolved ones at their redeemable payout." },
    ],
  };
}

function answerClaim(ctx: AskContext): Answer {
  const claimable = ctx.positions.filter((p) => p.claimable);
  if (claimable.length === 0) {
    return {
      blocks: [{ kind: "text", text: "Nothing to claim right now — you have no resolved winnings waiting." }],
    };
  }
  const total = claimable.reduce((s, p) => s + p.claimAmount, 0n);
  return {
    blocks: [
      { kind: "text", text: `You have ${fmt(total)} Points to claim from ${claimable.length} resolved market${claimable.length === 1 ? "" : "s"}:` },
      {
        kind: "bullets",
        items: claimable.map((p) => ({ label: `${fmt(p.claimAmount)} Points`, text: truncate(p.question, 44) })),
      },
      { kind: "note", text: "Head to Portfolio and hit “Claim all” to redeem these." },
    ],
  };
}

function answerMarket(ctx: AskContext, address?: string): Answer {
  const m = ctx.markets.find((x) => x.address === address) ?? headlineMarket(ctx.markets);
  if (!m) {
    return { blocks: [{ kind: "text", text: "There are no open markets to look at right now." }] };
  }
  const yesPct = pctNum(m.priceYes);
  const blocks: AnswerBlock[] = [
    { kind: "heading", text: truncate(m.question, 64) },
    {
      kind: "text",
      text: `YES is trading at ${yesPct.toFixed(1)}% — the market implies roughly a ${yesPct.toFixed(0)}% chance this resolves YES. Whether that's "rich" is your read of the catalysts, not mine.`,
    },
    {
      kind: "bullets",
      items: [
        { label: "Pricing:", text: "the LS-LMSR curve moves the price on every trade, so a thin book exaggerates a hot reading." },
        { label: "Resolution:", text: "this settles through the bonded oracle — 3 independent sources plus an LLM verdict, with a challenge window before it's final." },
      ],
    },
  ];
  const pos = ctx.positions.find((p) => p.address === m.address);
  if (pos && (pos.yes > 0n || pos.no > 0n)) {
    const side = pos.yes >= pos.no ? "YES" : "NO";
    blocks.push({
      kind: "bullets",
      items: [
        { label: "Your stake:", text: `${fmt(pos.yes)} YES / ${fmt(pos.no)} NO — you're net ${side}, marked at ${fmt(pos.value)} Points.` },
      ],
    });
  }
  blocks.push({ kind: "note", text: DISCLAIMER });
  return { blocks };
}

function answerHowResolution(): Answer {
  return {
    blocks: [
      { kind: "heading", text: "How SEER resolves a market" },
      {
        kind: "bullets",
        items: [
          { label: "1 · Propose:", text: "after the deadline, a proposer stakes a bond and requests resolution. The oracle gathers 3 independent sources, then an LLM reads them and returns a verdict (Yes / No / Invalid)." },
          { label: "2 · Challenge:", text: "the proposed outcome enters a challenge window. If no one disputes it before the window closes, it can be finalized as-is." },
          { label: "3 · Finalize & settle:", text: "once final, settle() pushes the outcome onto the market and winning shares become claimable 1:1 in Points." },
        ],
      },
      { kind: "note", text: "Every step — sources, the LLM prompt, its raw response, bonds — is on-chain and shown in each market's resolution receipt." },
    ],
  };
}

function answerHowDispute(): Answer {
  return {
    blocks: [
      { kind: "heading", text: "How a dispute works" },
      {
        kind: "bullets",
        items: [
          { label: "Challenge:", text: "while the window is open, anyone can dispute the proposed outcome by matching the proposer's bond." },
          { label: "Escalate:", text: "a dispute triggers a fresh LLM inference (escalation). Its verdict decides the final outcome — it can confirm or overturn the original proposal." },
          { label: "Bonds:", text: "the side that turns out wrong forfeits its bond to the side that was right, so disputing frivolously costs you." },
        ],
      },
      { kind: "note", text: "Open a market in the Challenge window to see the live countdown and the “Dispute” action." },
    ],
  };
}

function answerFallback(): Answer {
  return {
    blocks: [
      { kind: "text", text: "I answer from live market data — pick one of the suggestions below and I'll pull the real numbers." },
    ],
  };
}

export function answer(ctx: AskContext, intent: AskIntent, market?: string): Answer {
  switch (intent) {
    case "glance":
      return answerGlance(ctx);
    case "positions":
      return answerPositions(ctx);
    case "claim":
      return answerClaim(ctx);
    case "market":
      return answerMarket(ctx, market);
    case "howResolution":
      return answerHowResolution();
    case "howDispute":
      return answerHowDispute();
    default:
      return answerFallback();
  }
}
