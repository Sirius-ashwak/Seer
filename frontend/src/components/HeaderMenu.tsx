import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MoreHorizontal, Settings } from "lucide-react";
import { FaucetButton } from "@/components/FaucetButton";

// The header overflow ("⋯") menu — collects the low-priority controls (faucet,
// network status, settings) so the top bar stays uncluttered. Mirrors the
// outside-click + ESC + surface-pop popover pattern used by the account menu.
export function HeaderMenu({ onSettings }: { onSettings: () => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] border border-line bg-panel-2 text-muted transition-colors hover:border-line-strong hover:text-ink"
      >
        <MoreHorizontal className="size-4" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -2 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="surface-pop absolute right-0 z-30 mt-1.5 w-52 overflow-hidden rounded-[var(--radius-control)] p-1"
          >
            <FaucetButton onDone={() => setOpen(false)} />

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onSettings();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-[calc(var(--radius-control)-3px)] px-2.5 py-2 text-left text-[13px] text-muted transition-colors duration-100 hover:bg-panel-2 hover:text-ink"
            >
              <Settings className="size-3.5 shrink-0" />
              Settings
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
