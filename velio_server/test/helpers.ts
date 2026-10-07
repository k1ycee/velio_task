import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DbService } from '../src/db/db.service.js';

export async function createApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, db: app.get(DbService), http: () => request(app.getHttpServer()) };
}

let seq = 0;
/** A unique user each call, so tests never collide on phone/email. */
export function newUserBody(name = 'User') {
  const n = `${process.pid}${Date.now()}${seq++}`;
  return { name, phone: `+1${n}`, email: `u${n}@test.com` };
}

export async function createUser(app: INestApplication, name?: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/users').send(newUserBody(name)).expect(201);
  return res.body.id;
}

export async function eventsNamed(db: DbService, name: string, filter: { activityId?: string; planId?: string } = {}) {
  const r = await db.pool.query(
    `SELECT * FROM events WHERE name = $1
       AND ($2::bigint IS NULL OR activity_id = $2)
       AND ($3::bigint IS NULL OR plan_id = $3)
     ORDER BY id`,
    [name, filter.activityId ?? null, filter.planId ?? null],
  );
  return r.rows;
}
