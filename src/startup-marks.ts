/**
 * Startup timing for diagnosis: `cro:<name>` performance marks at real
 * boundaries, read by QA with performance.getEntriesByType('mark') and compared
 * with the network ledger. Nothing is sampled per frame and nothing is shown.
 *
 * Page marks happen at most once per page: the title shell, the game module and
 * the one world load. Attempt marks belong to one start (a title confirmation,
 * a cave visit or an autostart): each is recorded at most once per attempt, and
 * a new attempt clears the previous attempt's marks, so the entries never
 * accumulate. A caller passes the attempt it belongs to; a late callback of an
 * attempt that was left, failed or replaced records nothing.
 */
export const PAGE_MARKS = [
  'title-interactive',
  'game-module-ready',
  'world-start',
  'world-terrain-start',
  'world-terrain-end',
  'world-critical-loaded',
  'world-build-start',
  'world-build-end',
  'world-fit',
  'world-prepare-start',
  'world-ready',
] as const;
export const ATTEMPT_MARKS = [
  'confirm',
  'cave-load-start',
  'cave-catalog',
  'cave-template',
  'cave-images',
  'cave-playable',
  'proceed',
  'status',
  'socket-open',
  'welcome',
  'first-state',
  'arrival-ready',
  'controls',
  'first-move-sent',
  'first-move-confirmed',
  'first-gather-sent',
  'first-gather-confirmed',
] as const;
export type PageMark = (typeof PAGE_MARKS)[number];
export type AttemptMark = (typeof ATTEMPT_MARKS)[number];

export const MARK_PREFIX = 'cro:';

type Timing = Pick<Performance, 'mark' | 'clearMarks'>;
const browserTiming = (): Timing | null =>
  typeof performance !== 'undefined' && typeof performance.mark === 'function' ? performance : null;

export class StartupMarks {
  private attempt = 0;
  private readonly recorded = new Set<string>();

  constructor(private readonly timing: () => Timing | null = browserTiming) {}

  /** The attempt now being measured; 0 before the first start. */
  get current(): number {
    return this.attempt;
  }

  /** Recorded names, page marks first, in recording order. */
  get names(): string[] {
    return [...this.recorded];
  }

  page(name: PageMark): void {
    this.record(name, { page: true });
  }

  /** Start measuring a new attempt; the previous attempt's marks are cleared. */
  begin(): number {
    this.attempt++;
    for (const name of ATTEMPT_MARKS)
      if (this.recorded.delete(name)) this.call((timing) => timing.clearMarks(MARK_PREFIX + name));
    return this.attempt;
  }

  /** Record `name` for `owner`, only while it is still the current attempt. */
  mark(name: AttemptMark, owner = this.attempt): void {
    if (!owner || owner !== this.attempt) return;
    this.record(name, { attempt: owner });
  }

  has(name: PageMark | AttemptMark): boolean {
    return this.recorded.has(name);
  }

  private record(name: string, detail: object) {
    if (this.recorded.has(name)) return;
    this.recorded.add(name);
    this.call((timing) => timing.mark(MARK_PREFIX + name, { detail }));
  }

  // Measurement is optional: a browser without User Timing simply records nothing.
  private call(use: (timing: Timing) => unknown) {
    const timing = this.timing();
    if (!timing) return;
    try {
      use(timing);
    } catch {}
  }
}

export const startupMarks = new StartupMarks();
