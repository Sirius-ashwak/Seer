import { toast } from "sonner";
import type { ContractTransactionResponse } from "ethers";
import { prettyError } from "@/lib/format";

// Wrap a state-changing contract call in a single toast that tracks the
// pending → confirmed → failed lifecycle. Returns true on success.
export async function runTx(
  label: string,
  send: () => Promise<ContractTransactionResponse>,
): Promise<boolean> {
  const run = (async () => {
    const tx = await send();
    await tx.wait();
  })();

  toast.promise(run, {
    loading: `${label}…`,
    success: `${label} confirmed`,
    error: (err) => prettyError(err),
  });

  try {
    await run;
    return true;
  } catch {
    return false;
  }
}
