import { BadRequestException, Body, Controller, Get, Header, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DbService } from '../db/db.service.js';
import { readSetting } from '../settings.js';
import { computeMetrics, type Metrics } from './metrics.js';

// ponytail: no auth on the dashboard (auth is out of scope) — anyone who can reach it can read
// metrics and change the cap. Put it behind admin auth before this leaves a dev machine.
@Controller()
export class DashboardController {
  constructor(private readonly db: DbService) {}

  @Get('dashboard')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async dashboard() {
    const [m, cap] = await Promise.all([computeMetrics(this.db.pool), readSetting<number>(this.db.pool, 'new_user_cap')]);
    return renderDashboard(m, cap);
  }

  @Get('dashboard/metrics')
  metrics() {
    return computeMetrics(this.db.pool);
  }

  @Post('settings')
  async settings(@Body() body: Record<string, unknown>, @Res() res: Response) {
    const raw = String(body?.new_user_cap ?? '');
    if (!/^\d+$/.test(raw) || Number(raw) > 50) throw new BadRequestException('new_user_cap must be a whole number 0–50');
    await this.db.pool.query(
      `INSERT INTO settings (key, value) VALUES ('new_user_cap', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(Number(raw))],
    );
    res.redirect(303, '/dashboard');
  }
}

type Status = 'pass' | 'fail' | 'none' | 'tracked';

function tile(label: string, value: string, target: string, status: Status, detail = '') {
  const badge = { pass: 'On target', fail: 'Off target', none: 'No data yet', tracked: 'Tracked' }[status];
  return `<section class="tile ${status}">
    <h2>${label}</h2>
    <p class="value">${value}</p>
    <p class="meta"><span class="badge">${badge}</span>${target ? ` Target ${target}` : ''}</p>
    ${detail ? `<p class="detail">${detail}</p>` : ''}
  </section>`;
}

const fmt = (v: number | null, suffix = '') => (v === null ? '—' : `${v}${suffix}`);
const atLeast = (v: number | null, t: number): Status => (v === null ? 'none' : v >= t ? 'pass' : 'fail');

export function renderDashboard(m: Metrics, cap: number) {
  const claimStatus = (v: number | null) => atLeast(v, 25);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Velio Metrics</title>
<style>
  :root { --bg:#f6f5f2; --surface:#fff; --text:#1c1b19; --muted:#6b6860; --border:#e3e0d9;
          --pass:#1f6f5c; --pass-bg:#e3f2ec; --fail:#b3261e; --fail-bg:#fde8e6; --accent:#1f6f5c; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#151513; --surface:#1e1e1b; --text:#edebe6; --muted:#a19d94; --border:#34332f;
            --pass:#4fb89c; --pass-bg:#173129; --fail:#f2948c; --fail-bg:#3d1b18; --accent:#4fb89c; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.45 system-ui, -apple-system, sans-serif; }
  main { max-width: 1000px; margin: 0 auto; padding: 24px 16px 48px; }
  header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 20px; }
  h1 { margin: 0; font-size: 1.5rem; }
  a { color: var(--accent); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .tile { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
  .tile h2 { margin: 0; font-size: 0.85rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .value { margin: 8px 0 6px; font-size: 2rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .meta, .detail { margin: 0; font-size: 0.85rem; color: var(--muted); }
  .detail { margin-top: 6px; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-weight: 600; margin-right: 6px; background: var(--border); color: var(--muted); }
  .pass .badge { background: var(--pass-bg); color: var(--pass); }
  .fail .badge { background: var(--fail-bg); color: var(--fail); }
  .fail { border-color: var(--fail); }
  h3 { margin: 28px 0 12px; font-size: 1.1rem; }
  form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
  input, button { font: inherit; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); min-height: 40px; }
  input { width: 6rem; }
  button { background: var(--accent); color: var(--bg); border-color: var(--accent); font-weight: 600; cursor: pointer; }
</style>
</head>
<body>
<main>
  <header>
    <h1>Velio group bookings</h1>
    <a href="/dashboard">Refresh</a>
  </header>
  <div class="grid">
    ${tile('Oversold activities', String(m.oversoldActivities), '0, ever', m.oversoldActivities === 0 && m.countDrift === 0 ? 'pass' : 'fail', `Count drift: ${m.countDrift}`)}
    ${tile('Booking success', fmt(m.bookingSuccessPct, '%'), '≥ 99.5%', atLeast(m.bookingSuccessPct, 99.5), `${m.bookingFailures} failures in ${m.bookingAttempts} attempts on available spots`)}
    ${tile('Availability p95', fmt(m.latencyP95Ms, ' ms'), '≤ 2000 ms', m.latencyP95Ms === null ? 'none' : m.latencyP95Ms <= 2000 ? 'pass' : 'fail', `${m.latencySamples} samples`)}
    ${tile('Invite rate', fmt(m.inviteRatePct, '%'), '≥ 30%', atLeast(m.inviteRatePct, 30), `${m.inviters} of ${m.bookers} bookers created an invite`)}
    ${tile('Claim rate · vouch', fmt(m.claimRatePct.vouch, '%'), '≥ 25%', claimStatus(m.claimRatePct.vouch), 'Claims ÷ unique opens')}
    ${tile('Claim rate · public', fmt(m.claimRatePct.public, '%'), '≥ 25%', claimStatus(m.claimRatePct.public), 'Claims ÷ unique opens')}
    ${tile('K-factor', fmt(m.kFactor.total), '', m.kFactor.total === null ? 'none' : 'tracked', `Vouch ${fmt(m.kFactor.vouch)} · Public ${fmt(m.kFactor.public)}`)}
    ${tile('Plans that happened', `${m.plansHappened} / ${m.pastPlans}`, '', m.pastPlans === 0 ? 'none' : 'tracked', 'Past plans with the booker and ≥1 guest')}
  </div>

  <h3>Settings</h3>
  <form method="post" action="/settings">
    <label for="cap">New-user cap (held spots per booking)</label>
    <input id="cap" name="new_user_cap" type="number" min="0" max="50" value="${cap}" required>
    <button type="submit">Save</button>
  </form>
</main>
</body>
</html>`;
}
