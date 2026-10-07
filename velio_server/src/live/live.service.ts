import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Observable, Subject, filter } from 'rxjs';

export interface Availability {
  activityId: string;
  spotsLeft: number;
  version: number;
  /** Server time the count was committed; null for snapshots. Clients report latency against it. */
  committedAt: string | null;
}

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const CHANNEL_PREFIX = 'activity:';

/**
 * Redis is pub/sub only — Postgres decides every count. Each server instance publishes after
 * commit and relays everything it hears to its own SSE clients.
 */
@Injectable()
export class LiveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveService.name);
  private readonly pub = new Redis(REDIS_URL, { lazyConnect: true });
  private readonly sub = new Redis(REDIS_URL, { lazyConnect: true });
  private readonly updates = new Subject<Availability>();

  async onModuleInit() {
    await Promise.all([this.pub.connect(), this.sub.connect()]);
    // ponytail: every instance hears every activity; subscribe per activity if traffic ever demands it.
    await this.sub.psubscribe(`${CHANNEL_PREFIX}*`);
    this.sub.on('pmessage', (_pattern, _channel, message) => this.updates.next(JSON.parse(message)));
  }

  async onModuleDestroy() {
    this.updates.complete();
    await Promise.all([this.pub.quit(), this.sub.quit()]);
  }

  /** Call only after the transaction that changed the count has committed. */
  async publish(activityId: string, spotsLeft: number, version: number) {
    const update: Availability = { activityId, spotsLeft, version, committedAt: new Date().toISOString() };
    try {
      await this.pub.publish(CHANNEL_PREFIX + activityId, JSON.stringify(update));
    } catch (err) {
      // The commit already happened; clients resync from the snapshot on reconnect/resume.
      this.logger.error(`publish failed for activity ${activityId}`, err as Error);
    }
  }

  updatesFor(activityId: string): Observable<Availability> {
    return this.updates.pipe(filter((u) => u.activityId === activityId));
  }
}
