import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  MessageEvent,
  NotFoundException,
  Param,
  Post,
  Sse,
} from '@nestjs/common';
import { Observable, interval, map, merge } from 'rxjs';
import { DbService } from '../db/db.service.js';
import { requireId } from '../common/http.js';
import { track } from '../track/track.js';
import { Availability, LiveService } from './live.service.js';

const CLIENT_EVENTS = new Set(['availability_received']);

@Controller()
export class LiveController {
  constructor(
    private readonly db: DbService,
    private readonly live: LiveService,
  ) {}

  /**
   * Every committed change for every activity, on one connection — list pages use this so they
   * don't hit the browser's 6-connections-per-host limit on HTTP/1.1. No snapshot: clients open
   * this first, then load GET /activities (which carries versions) and keep the higher version.
   */
  @Sse('activities/stream')
  streamAll(): Observable<MessageEvent> {
    return merge(this.live.allUpdates().pipe(map((data): MessageEvent => ({ data }))), this.pings());
  }

  /**
   * Snapshot plus every committed change. Listens for updates *before* reading the snapshot, so a
   * commit can't slip into the gap between them; clients drop anything with version <= theirs.
   */
  @Sse('activities/:id/stream')
  async stream(@Param('id') id: string): Promise<Observable<MessageEvent>> {
    requireId(id);
    await this.snapshot(id); // 404 before the stream opens

    const data$ = new Observable<Availability>((subscriber) => {
      const sub = this.live.updatesFor(id).subscribe(subscriber);
      this.snapshot(id).then(
        (snap) => subscriber.next(snap),
        (err) => subscriber.error(err),
      );
      return sub;
    }).pipe(map((data): MessageEvent => ({ data })));
    return merge(data$, this.pings());
  }

  /** Keeps idle connections open through proxies and mobile networks. */
  private pings(): Observable<MessageEvent> {
    return interval(25_000).pipe(map((): MessageEvent => ({ type: 'ping', data: '{}' })));
  }

  private async snapshot(id: string): Promise<Availability> {
    const { rows } = await this.db.pool.query<{ spots_left: number; version: string }>(
      `SELECT spots_left, version FROM activities WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('activity not found');
    return { activityId: id, spotsLeft: rows[0].spots_left, version: Number(rows[0].version), committedAt: null };
  }

  /**
   * Client-reported events. availability_received → latency from commit to screen.
   * Corrects for client clock drift: (clientReceivedAt − clientSentAt) is measured on one clock,
   * then anchored to the server's clock at the moment the report arrives.
   */
  @Post('events')
  async report(@Body() body: Record<string, unknown>, @Headers('x-user-id') userId?: string) {
    const name = body?.name;
    if (typeof name !== 'string' || !CLIENT_EVENTS.has(name)) throw new BadRequestException('unsupported event');
    const props = (body.props ?? {}) as Record<string, unknown>;
    const committedAt = Date.parse(String(props.committedAt));
    const clientReceivedAt = Date.parse(String(props.clientReceivedAt));
    const clientSentAt = Date.parse(String(props.clientSentAt));
    if ([committedAt, clientReceivedAt, clientSentAt].some(Number.isNaN)) {
      throw new BadRequestException('committedAt, clientReceivedAt and clientSentAt must be ISO dates');
    }
    const receivedOnServerClock = Date.now() - (clientSentAt - clientReceivedAt);
    const latencyMs = Math.max(0, receivedOnServerClock - committedAt);

    const activityId = body.activityId == null ? null : requireId(String(body.activityId));
    await track(
      this.db.pool,
      name,
      { userId: userId && /^\d+$/.test(userId) ? userId : null, activityId },
      { latencyMs, version: props.version ?? null },
    );
    return { ok: true };
  }
}
