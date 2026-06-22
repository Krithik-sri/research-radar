/** Thrown when a provider keeps returning 429 after our retries are exhausted.
 *  Lets the backfill distinguish "daily free-tier cap reached → stop and resume
 *  later" from a genuine error. */
export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}
