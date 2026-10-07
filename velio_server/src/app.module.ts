import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DbModule } from './db/db.module.js';
import { UsersController } from './users/users.controller.js';
import { ActivitiesController } from './activities/activities.controller.js';
import { BookingsController } from './bookings/bookings.controller.js';
import { BookingsService } from './bookings/bookings.service.js';
import { InvitesController } from './invites/invites.controller.js';
import { InvitesService } from './invites/invites.service.js';
import { ExpiryService } from './expiry/expiry.service.js';
import { ScheduleModule } from '@nestjs/schedule';
import { LiveController } from './live/live.controller.js';
import { LiveService } from './live/live.service.js';
import { PgErrorFilter } from './common/http.js';
import { APP_FILTER } from '@nestjs/core';

@Module({
  imports: [DbModule, ScheduleModule.forRoot()],
  controllers: [AppController, UsersController, ActivitiesController, BookingsController, InvitesController, LiveController],
  providers: [AppService, BookingsService, InvitesService, ExpiryService, LiveService, { provide: APP_FILTER, useClass: PgErrorFilter }],
})
export class AppModule {}
