import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DbModule } from './db/db.module.js';
import { UsersController } from './users/users.controller.js';
import { ActivitiesController } from './activities/activities.controller.js';
import { PgErrorFilter } from './common/http.js';
import { APP_FILTER } from '@nestjs/core';

@Module({
  imports: [DbModule],
  controllers: [AppController, UsersController, ActivitiesController],
  providers: [AppService, { provide: APP_FILTER, useClass: PgErrorFilter }],
})
export class AppModule {}
