import { toast } from "sonner";
import type { ContractTransactionResponse } from "ethers";
import { prettyError } from "@/lib/format";
import { explorerTx } from "@/lib/contracts";

// Wrap a state-changing contract call in a single toast that tracks the
// pending → confirmed → failed lifecycle. On networks with a block explorer
// the success toast carries a "View" link to the mined transaction. Returns
// the transaction hash on success (truthy, so `if (ok)` still works) and null
// on failure — callers thread the hash into the activity log for explorer links.
export async function runTx(
  label: string,
  send: () => Promise<ContractTransactionResponse>,
): Promise<string | null> {
  const id = toast.loading(`${label}…`);
  try {
    const tx = await send();
    await tx.wait();
    const url = explorerTx(tx.hash);
    toast.success(`${label} confirmed`, {
      id,
      action: url
        ? { label: "View ↗", onClick: () => window.open(url, "_blank", "noopener,noreferrer") }
        : undefined,
    });
    return tx.hash;
  } catch (err) {
    toast.error(prettyError(err), { id });
    return null;
  }
}
