import { task } from "@trigger.dev/sdk";

/**
 * Walking-skeleton task (L0). Its only job is to prove the scaffold deploys and runs end-to-end
 * before any real logic is wired. Replaced by the poll + run tasks in L2.
 */
export const ping = task({
  id: "ping",
  run: async (payload: { at: string }) => {
    return { ok: true, echoed: payload.at };
  },
});
