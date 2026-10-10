/** Load order: a lower value starts first. Tiers separate kinds of work and,
 * inside a tier, nearer actors start first; equal values keep request order. */
export const LOAD_TIER = Object.freeze({
  /** The local player's actor and whoever carries it or is carried by it. */
  essential: 0,
  /** Startup assets requested ahead of the rest of the world. */
  initial: 1,
  /** Actors within interaction range. */
  near: 2,
  /** Terrain, regional scenery and resource props. */
  scene: 3,
  /** Other actors within the draw range. */
  visible: 4,
  /** Deferred companions after the world is ready. */
  companion: 5,
  /** Actors approaching the draw range: background work. */
  prefetch: 6,
});
const TIER_SPAN = 10_000;

export function loadPriority(tier: number, distance = 0): number {
  return tier * TIER_SPAN + Math.min(TIER_SPAN - 1, Math.max(0, distance || 0));
}

/** One consumer's interest in loads. The queue reads `priority` whenever it
 * chooses the next job, so a consumer reprioritizes by assigning it. */
export class LoadTicket {
  released = false;
  private readonly watchers = new Set<() => void>();
  constructor(public priority: number) {}
  static of(tier: number, distance = 0) {
    return new LoadTicket(loadPriority(tier, distance));
  }
  /** The result is no longer wanted: queued loads without another consumer are dropped. */
  release() {
    if (this.released) return;
    this.released = true;
    const watchers = [...this.watchers];
    this.watchers.clear();
    for (const watcher of watchers) watcher();
  }
  watch(watcher: () => void) {
    if (!this.released) this.watchers.add(watcher);
  }
  unwatch(watcher: () => void) {
    this.watchers.delete(watcher);
  }
  /** Queues still holding this ticket on a queued or running job. */
  get watching() {
    return this.watchers.size;
  }
}

/** Distance-owned requests by key, one ticket per wanted key. A key that stops
 * being wanted releases its ticket, so a queued load nobody else needs is
 * cancelled; a started load completes and its template is reused later. */
export class LoadDemand {
  private readonly tickets = new Map<string, LoadTicket>();

  /** Keys with a live request. */
  get size() {
    return this.tickets.size;
  }
  has(key: string) {
    return this.tickets.has(key);
  }
  keys() {
    return this.tickets.keys();
  }
  /** This round's wanted keys and priorities: newly wanted keys are requested
   * with `start`, the rest are reprioritized and unwanted keys are withdrawn. */
  update(wanted: ReadonlyMap<string, number>, start: (key: string, ticket: LoadTicket) => void) {
    for (const [key, ticket] of this.tickets)
      if (!wanted.has(key)) {
        this.tickets.delete(key);
        ticket.release();
      }
    for (const [key, priority] of wanted) {
      const current = this.tickets.get(key);
      if (current) {
        current.priority = priority;
        continue;
      }
      const ticket = new LoadTicket(priority);
      this.tickets.set(key, ticket);
      start(key, ticket);
    }
  }
  /** The request made with `ticket` settled: a later want requests again. */
  settle(key: string, ticket: LoadTicket) {
    if (this.tickets.get(key) === ticket) this.tickets.delete(key);
  }
  /** Withdraw every request (disposal). */
  clear() {
    const tickets = [...this.tickets.values()];
    this.tickets.clear();
    for (const ticket of tickets) ticket.release();
  }
}

/** Settles loads that nobody waits for any more. Not an asset error. */
export class LoadCancelled extends Error {
  readonly cancelled = true;
  constructor(key: string, reason = 'no consumer remains') {
    super(`Asset load cancelled (${reason}): ${key}`);
    this.name = 'LoadCancelled';
  }
}

export function isLoadCancelled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { cancelled?: unknown }).cancelled === true
  );
}

interface LoadJob {
  readonly key: string;
  readonly start: () => unknown;
  readonly promise: Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly tickets: Set<LoadTicket>;
  background: boolean;
}

/** Coalesces verified loads by key and runs at most `limit` at once, best
 * priority first. Background work holds at most `backgroundLimit` slots, so
 * newly needed nearby work never waits behind more than the remaining slots.
 * Started jobs run to completion; owners discard results nobody wants. */
export class AssetLoadQueue {
  readonly queued: LoadJob[] = [];
  private readonly jobs = new Map<string, LoadJob>();
  /** Live jobs per ticket: a ticket is watched only while one of them remains. */
  private readonly holds = new Map<LoadTicket, number>();
  private readonly priorityGates = new Map<symbol, number>();
  private readonly prune = () => this.dropUnwanted();
  active = 0;
  activeBackground = 0;
  disposed = false;
  readonly stats = { started: 0, completed: 0, failed: 0, cancelled: 0 };

  constructor(
    readonly limit = 2,
    readonly backgroundLimit = 1,
    readonly backgroundFrom = loadPriority(LOAD_TIER.prefetch),
  ) {}

  /** Temporarily leave work at or below this urgency queued. Entry uses this
   * to reserve bandwidth for its verified floor/body and the join handshake.
   * In-flight work is never interrupted; withdrawal/disposal still settles
   * gated jobs, and an essential consumer can promote one through the gate. */
  deferFrom(priority: number): () => void {
    if (!Number.isFinite(priority)) throw new Error('A load gate needs a finite priority');
    const token = Symbol('load priority gate');
    this.priorityGates.set(token, priority);
    return () => {
      if (!this.priorityGates.delete(token)) return;
      this.pump();
    };
  }

  /** Queue `start` under `key`, or join the queued or running job with that key. */
  request<T>(key: string, start: () => Promise<T>, ticket: LoadTicket): Promise<T> {
    if (this.disposed) return Promise.reject(new LoadCancelled(key, 'disposed'));
    let job = this.jobs.get(key);
    if (!job) {
      let resolve!: (value: unknown) => void, reject!: (error: unknown) => void;
      const promise = new Promise<unknown>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      job = { key, start, promise, resolve, reject, tickets: new Set(), background: false };
      this.jobs.set(key, job);
      this.queued.push(job);
    }
    this.join(key, ticket);
    this.pump();
    return job.promise as Promise<T>;
  }

  /** Add a consumer to the job with this key; false when there is none. */
  join(key: string, ticket: LoadTicket): boolean {
    const job = this.jobs.get(key);
    if (!job) return false;
    if (!job.tickets.has(ticket)) {
      job.tickets.add(ticket);
      const holds = (this.holds.get(ticket) ?? 0) + 1;
      this.holds.set(ticket, holds);
      if (holds === 1) ticket.watch(this.prune);
    }
    return true;
  }

  has(key: string) {
    return this.jobs.has(key);
  }

  /** Start the best queued jobs that fit. Call after reassigning priorities. */
  pump() {
    this.dropUnwanted();
    while (!this.disposed && this.active < this.limit) {
      const job = this.next();
      if (!job) return;
      this.run(job);
    }
  }

  diagnostics() {
    return {
      active: this.active,
      queued: this.queued.length,
      background: this.activeBackground,
      ...this.stats,
    };
  }

  /** Queued callers settle now; running jobs settle through their own work. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.priorityGates.clear();
    for (const job of this.queued.splice(0)) this.cancel(job, 'disposed');
  }

  private priorityOf(job: LoadJob) {
    let priority = Infinity;
    for (const ticket of job.tickets)
      if (!ticket.released && ticket.priority < priority) priority = ticket.priority;
    return priority;
  }

  private next() {
    let best: LoadJob | null = null,
      bestPriority = Infinity;
    const ceiling = Math.min(Infinity, ...this.priorityGates.values());
    // `queued` is in request order, so a strict comparison keeps ties stable.
    for (const job of this.queued) {
      const priority = this.priorityOf(job);
      if (priority >= ceiling) continue;
      if (priority >= this.backgroundFrom && this.activeBackground >= this.backgroundLimit)
        continue;
      if (priority < bestPriority) {
        best = job;
        bestPriority = priority;
      }
    }
    return best;
  }

  private run(job: LoadJob) {
    this.queued.splice(this.queued.indexOf(job), 1);
    job.background = this.priorityOf(job) >= this.backgroundFrom;
    this.active++;
    if (job.background) this.activeBackground++;
    this.stats.started++;
    let work: Promise<unknown>;
    try {
      work = Promise.resolve(job.start());
    } catch (error) {
      work = Promise.reject(error);
    }
    // Free the slot and start the next job before callers resume.
    work.then(
      (value) => {
        this.finish(job);
        this.stats.completed++;
        job.resolve(value);
      },
      (error) => {
        this.finish(job);
        if (isLoadCancelled(error)) this.stats.cancelled++;
        else this.stats.failed++;
        job.reject(error);
      },
    );
  }

  private finish(job: LoadJob) {
    this.active--;
    if (job.background) this.activeBackground--;
    this.forget(job);
    this.pump();
  }

  /** The job left the queue: stop watching tickets no other job of ours holds. */
  private forget(job: LoadJob) {
    if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
    for (const ticket of job.tickets) {
      const holds = (this.holds.get(ticket) ?? 1) - 1;
      if (holds > 0) this.holds.set(ticket, holds);
      else {
        this.holds.delete(ticket);
        ticket.unwatch(this.prune);
      }
    }
    job.tickets.clear();
  }

  private dropUnwanted() {
    for (let index = this.queued.length - 1; index >= 0; index--) {
      const job = this.queued[index];
      let wanted = false;
      for (const ticket of job.tickets) wanted ||= !ticket.released;
      if (wanted) continue;
      this.queued.splice(index, 1);
      this.cancel(job, 'no consumer remains');
    }
  }

  private cancel(job: LoadJob, reason: string) {
    this.forget(job);
    this.stats.cancelled++;
    job.reject(new LoadCancelled(job.key, reason));
  }
}
