import { Inngest } from "inngest";

/**
 * Inngest client. Reads INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY from the
 * environment automatically (unset in local dev → talks to the dev server).
 */
export const inngest = new Inngest({ id: "research-radar" });
