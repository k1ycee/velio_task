import { Body, Controller, Post } from '@nestjs/common';
import { UserId, requireId, requireInt } from '../common/http.js';
import { BookingsService } from './bookings.service.js';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  book(@UserId() bookerId: string, @Body() body: Record<string, unknown>) {
    const activityId = requireId(String(body?.activityId ?? ''));
    const heldSpots = requireInt(body, 'heldSpots', 0);
    return this.bookings.book(bookerId, activityId, heldSpots);
  }
}
