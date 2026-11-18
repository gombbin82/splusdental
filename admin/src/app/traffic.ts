// Website traffic page (admin only). Renders GA4 aggregates from /api/admin/traffic.
// All labels from the API (page titles, paths) go into the DOM with textContent.
import { $, api, handleAuthFailure, setText } from './shell';
import {
  axisScale,
  channelLabel,
  compact,
  delta,
  deviceLabel,
  duration,
  share,
  shortDate,
} from './traffic-utils';

interface Totals {
  activeUsers: number;
  newUsers: number;
  sessions: number;
  pageViews: number;
  engagementRate: number;
  avgSessionDuration: number;
}

interface Traffic {
  days: number;
  start: string;
  end: string;
  timeZone: string;
  totals: Totals;
  previous: Totals;
  daily: { date: string; users: number; sessions: number }[];
  pages: { path: string; title: string; views: number; users: number }[];
  sources: { channel: string; sessions: number; users: number }[];
  devices: { device: string; users: number }[];
  bookingClicks: number;
  gbp: { sessions: number; users: number; previousSessions: number };
}

const SVG = 'http://www.w3.org/2000/svg';
const RANGE_KEY = 'splus-admin-traffic-days';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

// ---------- tiles ----------

function tile(label: string, value: string, cur?: number, prev?: number, hint?: string) {
  const t = el('div', 'tile');
  t.append(el('p', 'tile-label', label), el('p', 'tile-value', value));
  const d = cur !== undefined && prev !== undefined ? delta(cur, prev) : null;
  if (d) {
    const p = el('p', `tile-delta is-${d.dir}`);
    p.append(el('span', 'tile-arrow', d.dir === 'up' ? '▲' : d.dir === 'down' ? '▼' : '•'));
    p.append(` ${d.text} `, el('span', 'tile-vs', 'vs previous period'));
    t.append(p);
  } else if (hint) {
    t.append(el('p', 'tile-delta', hint));
  }
  return t;
}

function renderTiles(t: Traffic) {
  const { totals: c, previous: p } = t;
  $('t-tiles').replaceChildren(
    tile('Visitors', compact(c.activeUsers), c.activeUsers, p.activeUsers),
    tile('Page views', compact(c.pageViews), c.pageViews, p.pageViews),
    tile(
      'Appointment button clicks',
      compact(t.bookingClicks),
      undefined,
      undefined,
      'Clicks through to online booking',
    ),
    tile(
      'From Google Business Profile',
      compact(t.gbp.sessions),
      t.gbp.sessions,
      t.gbp.previousSessions,
      'Visits via the website link on Google',
    ),
    tile(
      'Average visit',
      duration(c.avgSessionDuration),
      c.avgSessionDuration,
      p.avgSessionDuration,
    ),
    tile(
      'New visitors',
      `${share(c.newUsers, c.activeUsers)}%`,
      undefined,
      undefined,
      `${compact(c.newUsers)} first-time visitors`,
    ),
  );
}

// ---------- daily chart ----------

function renderChart(t: Traffic) {
  const host = $('t-chart');
  const tip = $('t-tip');
  // Draw at the container's real width so labels stay 12px on phones (no viewBox scaling).
  const W = Math.max(300, host.clientWidth - 32 || 960);
  const H = W < 600 ? 200 : 260;
  const pad = { top: 12, right: 8, bottom: 28, left: 40 };
  const iw = W - pad.left - pad.right;
  const ih = H - pad.top - pad.bottom;
  const { max, step } = axisScale(Math.max(0, ...t.daily.map((d) => d.users)));
  const n = t.daily.length;
  const slot = iw / n;
  const gap = Math.min(2, slot * 0.25);
  const bw = Math.max(1, slot - gap);
  const y = (v: number) => pad.top + ih - (v / max) * ih;

  const root = svg('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'chart-svg',
    role: 'img',
    'aria-label': `Visitors per day, ${shortDate(t.start)} to ${shortDate(t.end)}. Use "Show as table" for values.`,
  });

  // Gridlines + y labels at round steps, recessive.
  for (let v = 0; v <= max; v += step) {
    const gy = y(v);
    root.append(
      svg('line', { x1: pad.left, x2: W - pad.right, y1: gy, y2: gy, class: v ? 'grid' : 'axis' }),
    );
    const label = svg('text', { x: pad.left - 8, y: gy + 4, class: 'tick', 'text-anchor': 'end' });
    label.textContent = compact(v);
    root.append(label);
  }

  // X labels: first, last, and evenly spaced in between (about one per 70px, at most 7).
  const every = Math.max(1, Math.ceil(n / Math.min(7, Math.floor(iw / 70))));
  t.daily.forEach((d, i) => {
    if (i % every !== 0 && i !== n - 1) return;
    if (i !== n - 1 && n - 1 - i < every / 2) return; // keep the last label from colliding
    const label = svg('text', {
      x: pad.left + i * slot + slot / 2,
      y: H - 8,
      class: 'tick',
      'text-anchor': 'middle',
    });
    label.textContent = shortDate(d.date);
    root.append(label);
  });

  // Bars: 4px rounded top, flat on the baseline. The full-height column is the hit target.
  const r = Math.min(4, bw / 2);
  t.daily.forEach((d, i) => {
    const x = pad.left + i * slot + gap / 2;
    const top = y(d.users);
    const h = pad.top + ih - top;
    const g = svg('g', { class: 'bar' });
    g.append(
      svg('rect', { x: pad.left + i * slot, y: pad.top, width: slot, height: ih, class: 'hit' }),
    );
    if (h > 0) {
      const rr = Math.min(r, h);
      g.append(
        svg('path', {
          class: 'bar-fill',
          d: `M${x},${top + h}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + bw - rr}Q${x + bw},${top} ${x + bw},${top + rr}V${top + h}Z`,
        }),
      );
    }
    const show = (ev: PointerEvent) => {
      tip.replaceChildren(
        el('strong', 'tip-value', `${d.users.toLocaleString('en-US')} visitors`),
        el(
          'span',
          'tip-label',
          `${d.sessions.toLocaleString('en-US')} visits · ${shortDate(d.date)}`,
        ),
      );
      tip.hidden = false;
      const box = host.getBoundingClientRect();
      const tx = Math.min(Math.max(ev.clientX - box.left, 70), box.width - 70);
      tip.style.left = `${tx}px`;
      tip.style.top = `${Math.max(0, (top / H) * box.height - 8)}px`;
      g.classList.add('is-hover');
    };
    g.addEventListener('pointermove', show);
    g.addEventListener('pointerleave', () => {
      tip.hidden = true;
      g.classList.remove('is-hover');
    });
    root.append(g);
  });

  host.replaceChildren(root);

  $('t-daily-body').replaceChildren(
    ...[...t.daily].reverse().map((d) => {
      const tr = el('tr');
      tr.append(
        el('td', 'nowrap', shortDate(d.date)),
        el('td', 'num', d.users.toLocaleString('en-US')),
        el('td', 'num', d.sessions.toLocaleString('en-US')),
      );
      return tr;
    }),
  );
}

// ---------- lists ----------

function renderPages(t: Traffic) {
  const body = $('t-pages');
  if (!t.pages.length) {
    const tr = el('tr');
    const td = el('td', 'empty-row', 'No page views in this period.');
    td.colSpan = 3;
    tr.append(td);
    body.replaceChildren(tr);
    return;
  }
  body.replaceChildren(
    ...t.pages.map((p) => {
      const tr = el('tr');
      const page = el('td', 'page-cell');
      page.append(el('span', 'page-title', p.title || p.path), el('span', 'page-path', p.path));
      tr.append(page, el('td', 'num', compact(p.views)), el('td', 'num', compact(p.users)));
      return tr;
    }),
  );
}

function renderBars(id: string, rows: { label: string; value: number }[], unit: string) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  const list = $(id);
  if (!rows.length) {
    list.replaceChildren(el('li', 'bars-empty', 'No data in this period.'));
    return;
  }
  list.replaceChildren(
    ...rows.map((r) => {
      const pct = share(r.value, total);
      const li = el('li', 'bars-row');
      const head = el('div', 'bars-head');
      head.append(el('span', 'bars-label', r.label), el('span', 'bars-value', `${pct}%`));
      const track = el('div', 'bars-track');
      const fill = el('div', 'bars-fill');
      fill.style.width = `${Math.max(pct, r.value > 0 ? 1 : 0)}%`;
      track.append(fill);
      li.title = `${r.value.toLocaleString('en-US')} ${unit}`;
      li.append(head, track);
      return li;
    }),
  );
}

// ---------- page ----------

let current: Traffic | null = null;
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => current && renderChart(current), 150);
});

function render(t: Traffic) {
  current = t;
  $('t-range').textContent =
    `${shortDate(t.start)} – ${shortDate(t.end)}, compared with the ${t.days} days before`;
  renderTiles(t);
  renderChart(t);
  renderPages(t);
  renderBars(
    't-sources',
    t.sources.map((s) => ({ label: channelLabel(s.channel), value: s.sessions })),
    'visits',
  );
  renderBars(
    't-devices',
    t.devices.map((d) => ({ label: deviceLabel(d.device), value: d.users })),
    'visitors',
  );
}

function showSetup(title: string, text: string) {
  $('t-setup-title').textContent = title;
  $('t-setup-text').textContent = text;
  $('t-setup').hidden = false;
  $('t-report').hidden = true;
  $('range').hidden = true;
}

export function initTrafficPage() {
  const range = $('range');
  const buttons = [...range.querySelectorAll<HTMLButtonElement>('[data-days]')];
  let days = '28';
  try {
    const saved = localStorage.getItem(RANGE_KEY);
    if (saved && ['7', '28', '90'].includes(saved)) days = saved;
  } catch {
    // storage unavailable: default range
  }

  const load = async () => {
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.days === days)));
    range.hidden = false;
    $('t-report').setAttribute('aria-busy', 'true');
    setText($('t-error'), '');
    try {
      const t = await api<Traffic>(`/api/admin/traffic?days=${days}`);
      $('t-setup').hidden = true;
      $('t-report').hidden = false;
      render(t);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      const code = (err as Error).message;
      if (code === 'analytics_disabled') {
        showSetup(
          "Traffic reports aren't connected yet",
          "Set ga4_property_id in this environment's Terraform configuration (infra/README.md → Website analytics).",
        );
      } else if (code === 'analytics_forbidden') {
        showSetup(
          "Google Analytics hasn't granted access yet",
          "In Google Analytics → Admin → Property access management, add the API's service account as a Viewer (infra/README.md → Website analytics).",
        );
      } else {
        setText(
          $('t-error'),
          "Couldn't load traffic from Google Analytics. Try again in a minute.",
        );
      }
    } finally {
      $('t-report').removeAttribute('aria-busy');
    }
  };

  buttons.forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.days === days) return;
      days = b.dataset.days ?? '28';
      try {
        localStorage.setItem(RANGE_KEY, days);
      } catch {
        // ignore
      }
      void load();
    }),
  );

  void load();
}
