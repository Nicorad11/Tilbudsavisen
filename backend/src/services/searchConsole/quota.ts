/**
 * Kvoten for URL Inspection API er 600 kald pr. minut og 2.000 pr. døgn pr.
 * ejendom. Vi holder os klart under. Både cron og manuelle tjek tæller med.
 */
export const INSPECT_PER_MINUTE = 300;
export const INSPECT_PER_DAY = 1500;
/** Højst så mange URL'er pr. synkronisering (alle 123 nuværende URL'er når med hver dag). */
export const INSPECT_PER_RUN = 300;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export interface QuotaOptions {
  perMinute?: number;
  perDay?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Glidende vinduer pr. minut og pr. døgn. `previous` er tidspunkterne for kald det seneste døgn. */
export class QuotaLimiter {
  private calls: number[];
  private readonly perMinute: number;
  private readonly perDay: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(previous: number[] = [], o: QuotaOptions = {}) {
    this.perMinute = o.perMinute ?? INSPECT_PER_MINUTE;
    this.perDay = o.perDay ?? INSPECT_PER_DAY;
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.calls = [...previous].sort((a, b) => a - b);
  }

  private prune(now: number) {
    this.calls = this.calls.filter((t) => t > now - DAY);
  }

  /** Kald tilbage i dag (glidende 24 timer). */
  remainingToday(): number {
    this.prune(this.now());
    return Math.max(0, this.perDay - this.calls.length);
  }

  /**
   * Reserverer ét kald. Venter, hvis minut-kvoten er brugt.
   * false = døgnkvoten er brugt – stop for i dag.
   */
  async acquire(): Promise<boolean> {
    let now = this.now();
    this.prune(now);
    if (this.calls.length >= this.perDay) return false;
    const inLastMinute = this.calls.filter((t) => t > now - MINUTE);
    if (inLastMinute.length >= this.perMinute) {
      await this.sleep(inLastMinute[inLastMinute.length - this.perMinute]! + MINUTE - now);
      now = this.now();
    }
    this.calls.push(now);
    return true;
  }
}
