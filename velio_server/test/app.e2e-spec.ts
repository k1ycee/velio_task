import { INestApplication } from '@nestjs/common';
import { createApp } from './helpers.js';

let app: INestApplication;
let http: Awaited<ReturnType<typeof createApp>>['http'];

beforeAll(async () => ({ app, http } = await createApp()));
afterAll(() => app.close());

describe('GET /', () => {
  it('sends people to the dashboard instead of a placeholder page', async () => {
    await http().get('/').expect(302).expect('Location', '/dashboard');
  });
});
