import * as vscode from 'vscode';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  planUsagePercentFieldKeys,
  readIncludedUsage,
  readOnDemandBreakdown,
  readPlanInfo,
} from './usageParse';
import {
  tierFromPercent,
  tierFromSpendUsd,
  type UsageTier,
} from './usageDisplay';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const initSqlJs = require('sql.js/dist/sql-asm.js');

const CONNECT_PATH = '/aiserver.v1.DashboardService/GetCurrentPeriodUsage';
const HOSTS = ['api2.cursor.sh', 'api3.cursor.sh'] as const;
const DEEPLINK_SETTINGS = 'cursor://anysphere.cursor-deeplink/settings';
const AUTH_DB_REFRESH_MS = 5 * 60 * 1000;
const AUTH_FALLBACK_TTL_MS = 12 * 60 * 60 * 1000;

const log = vscode.window.createOutputChannel('Cursor Usage Counter');
let sqlRuntimePromise: Promise<{
  Database: new (data?: Uint8Array) => { exec: (sql: string) => Array<{ values: unknown[][] }>; close: () => void };
}> | null = null;
let lastAuthSnapshot: { accessToken: string | null; planLabel: string | null; readAt: number } | null = null;

function logApiVerbose(): boolean {
  return vscode.workspace.getConfiguration('cursorUsageCounter').get<boolean>('logApiResponses', false);
}

function maskToken(t: string): string {
  const s = t.trim();
  if (s.length <= 24) {
    return `(${s.length} chars)`;
  }
  return `${s.slice(0, 14)}…${s.slice(-8)} (${s.length} chars)`;
}

export function activate(context: vscode.ExtensionContext): void {
  const items = createUsageItems();

  let chain: Promise<void> = Promise.resolve();
  const refresh = (): void => {
    chain = chain.then(() => paint(items)).catch(() => {});
  };

  let poll: ReturnType<typeof setInterval> | undefined;
  const armPoll = (): void => {
    if (poll) {
      clearInterval(poll);
    }
    const s = vscode.workspace.getConfiguration('cursorUsageCounter').get<number>('refreshIntervalSeconds', 30);
    poll = setInterval(refresh, Math.max(10, s) * 1000);
  };

  context.subscriptions.push(
    ...Object.values(items),
    log,
    vscode.commands.registerCommand('cursorUsageCounter.refresh', refresh),
    vscode.commands.registerCommand('cursorUsageCounter.openCursorBilling', () => {
      void openBilling();
    }),
    vscode.commands.registerCommand('cursorUsageCounter.showLog', () => log.show(true)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('cursorUsageCounter')) {
        armPoll();
        refresh();
        if (e.affectsConfiguration('cursorUsageCounter.logApiResponses')) {
          log.appendLine(
            `[cfg] logApiResponses = ${logApiVerbose()} @ ${new Date().toISOString()}`,
          );
        }
      }
    }),
    vscode.window.onDidChangeActiveColorTheme(() => refresh()),
    vscode.window.onDidChangeWindowState((w) => {
      if (w.focused) {
        refresh();
      }
    }),
    {
      dispose: () => {
        if (poll) {
          clearInterval(poll);
        }
      },
    },
  );

  armPoll();
  refresh();
}

export function deactivate(): void {}

function getPriority(): number {
  return vscode.workspace.getConfiguration('cursorUsageCounter').get<number>('statusBarPriority', -1000);
}

function isLightTheme(): boolean {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight;
}

/** Softer pastel-ish tier colors with per-theme contrast tuning. */
function pastelTierColor(tier: UsageTier, light: boolean): string {
  if (tier === 'ok') {
    return light ? '#2f855a' : '#86efac';
  }
  if (tier === 'warn') {
    return light ? '#b7791f' : '#fcd34d';
  }
  return light ? '#c0565b' : '#fca5a5';
}

/** Theme-aware tiers using softer foreground colors, no hard status-bar chip background. */
function applyUsageTierStyle(item: vscode.StatusBarItem, tier: UsageTier | undefined): void {
  item.backgroundColor = undefined;
  item.color = tier ? pastelTierColor(tier, isLightTheme()) : undefined;
}

function tierLabel(tier: UsageTier | undefined): string {
  if (tier === 'ok') {
    return 'good';
  }
  if (tier === 'warn') {
    return 'warning';
  }
  if (tier === 'danger') {
    return 'high';
  }
  return 'n/a';
}

function percentTooltip(label: string, pct: number): string {
  const tier = tierFromPercent(pct);
  return `${label}\nUsage: ${Math.round(pct)}%\nStatus: ${tierLabel(tier)}\nClick: Settings`;
}

function spendTooltip(usd: number, planLabel: string | null): string {
  const tier = tierFromSpendUsd(usd);
  const planLine = planLabel ? `Plan: ${planLabel}` : 'Plan: (not reported by API)';
  return `On-demand Spend\nThis cycle: $${usd.toFixed(2)}\n${planLine}\nStatus: ${tierLabel(tier)}\nClick: Settings`;
}

async function openBilling(): Promise<void> {
  if (!(await vscode.env.openExternal(vscode.Uri.parse(DEEPLINK_SETTINGS)))) {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'cursor');
  }
}

type UsageItems = {
  total: vscode.StatusBarItem;
  autoComposer: vscode.StatusBarItem;
  api: vscode.StatusBarItem;
  spend: vscode.StatusBarItem;
};

function createUsageItems(): UsageItems {
  const base = getPriority();
  const total = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, base + 3);
  const autoComposer = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, base + 2);
  const api = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, base + 1);
  const spend = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, base);
  for (const item of [total, autoComposer, api, spend]) {
    item.command = 'cursorUsageCounter.openCursorBilling';
  }
  return { total, autoComposer, api, spend };
}

function clearItemStyle(item: vscode.StatusBarItem): void {
  item.color = undefined;
  item.backgroundColor = undefined;
}

function showSingleStatus(items: UsageItems, text: string, tooltip: string): void {
  for (const item of [items.total, items.autoComposer, items.api]) {
    item.text = '';
    item.hide();
    clearItemStyle(item);
  }
  items.spend.text = text;
  items.spend.tooltip = tooltip;
  clearItemStyle(items.spend);
  items.spend.show();
}

async function paint(items: UsageItems): Promise<void> {
  const verbose = logApiVerbose();
  const auth = await readAuthMeta(verbose);
  const token = auth.accessToken;
  if (!token) {
    showSingleStatus(items, 'usage: sign in', 'Sign in to Cursor.');
    if (verbose) {
      log.appendLine(`[token] missing — open Cursor Settings → sign in (or check state.vscdb path below)`);
      log.appendLine(`[token] db path: ${cursorDb() ?? '(unknown)'}`);
    }
    return;
  }

  try {
    const data = await fetchUsageWithTokenRefresh(token, verbose);
    const usage = readIncludedUsage(data);
    const ond = readOnDemandBreakdown(data);
    const usd = ond.usd;
    const apiPlan = readPlanInfo(data);
    const planLabel = auth.planLabel ?? apiPlan.label;

    if (usage.total !== undefined) {
      items.total.text = `📊 ${Math.round(usage.total)}%`;
      applyUsageTierStyle(items.total, tierFromPercent(usage.total));
      items.total.tooltip = percentTooltip('Included Total', usage.total);
      items.total.show();
    } else {
      items.total.text = '';
      items.total.hide();
    }

    if (usage.autoComposer !== undefined) {
      items.autoComposer.text = `🤖 ${Math.round(usage.autoComposer)}%`;
      applyUsageTierStyle(items.autoComposer, tierFromPercent(usage.autoComposer));
      items.autoComposer.tooltip = percentTooltip('Auto + Composer', usage.autoComposer);
      items.autoComposer.show();
    } else {
      items.autoComposer.text = '';
      items.autoComposer.hide();
    }

    if (usage.api !== undefined) {
      items.api.text = `🔌 ${Math.round(usage.api)}%`;
      applyUsageTierStyle(items.api, tierFromPercent(usage.api));
      items.api.tooltip = percentTooltip('API Pool', usage.api);
      items.api.show();
    } else {
      items.api.text = '';
      items.api.hide();
    }

    items.spend.text = `$${usd.toFixed(2)}`;
    applyUsageTierStyle(items.spend, tierFromSpendUsd(usd));
    items.spend.tooltip = spendTooltip(usd, planLabel);
    items.spend.show();

    const parts = [items.total, items.autoComposer, items.api, items.spend]
      .filter((x) => x.text.trim() !== '')
      .map((x) => x.text);
    if (verbose) {
      log.appendLine(`[status bar] ${new Date().toISOString()} ${parts.join(' · ')}`);
    }
    if (verbose) {
      const keys = planUsagePercentFieldKeys(data);
      log.appendLine(
        `[parsed] included ${JSON.stringify(usage)}, planUsage % keys: [${keys.join(', ')}]`,
      );
      log.appendLine(
        `[parsed] spendLimitUsage.individualUsed raw=${JSON.stringify(ond.raw)} cents=${ond.cents === null ? 'null' : ond.cents} → $${usd.toFixed(2)} (÷100; match “On-demand” / spend limit in Cursor)`,
      );
      log.appendLine(
        `[parsed] plan auth=${auth.planLabel ?? '(missing)'} apiRaw=${JSON.stringify(apiPlan.raw)} apiLabel=${apiPlan.label ?? '(missing)'} final=${planLabel ?? '(missing)'}`,
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showSingleStatus(
      items,
      isAuthFailure(msg) ? 'usage: re-auth' : 'usage: error',
      isAuthFailure(msg)
        ? 'Session expired. Open Cursor Settings and sign in again, then refresh.'
        : msg,
    );
    log.appendLine(`[status bar] ${new Date().toISOString()} ERROR: ${msg}`);
  }
}

async function readAccessToken(verbose: boolean): Promise<string | null> {
  return (await readAuthMeta(verbose)).accessToken;
}

async function readAuthMeta(
  verbose: boolean,
  forceFresh = false,
): Promise<{ accessToken: string | null; planLabel: string | null }> {
  if (
    !forceFresh &&
    lastAuthSnapshot &&
    Date.now() - lastAuthSnapshot.readAt < AUTH_DB_REFRESH_MS
  ) {
    if (verbose) {
      log.appendLine('[token] using recent cached auth metadata (skip DB read)');
    }
    return {
      accessToken: lastAuthSnapshot.accessToken,
      planLabel: lastAuthSnapshot.planLabel,
    };
  }

  const dbPath = cursorDb();
  if (!dbPath || !fs.existsSync(dbPath)) {
    if (verbose) {
      log.appendLine(`[token] state.vscdb not found: ${dbPath ?? '(null)'}`);
    }
    return { accessToken: null, planLabel: null };
  }
  if (verbose) {
    log.appendLine(`[token] opening ${dbPath}`);
  }
  try {
    const SQL = await getSqlRuntime();
    const db = new SQL.Database(fs.readFileSync(dbPath));
    try {
      const r = db.exec(
        "SELECT key, value FROM ItemTable WHERE key IN ('cursorAuth/accessToken','cursorAuth/stripeMembershipType')",
      );
      const kv = new Map<string, string>();
      if (r.length && r[0].values.length) {
        for (const row of r[0].values) {
          const k = String(row[0]);
          const v = String(row[1]).trim();
          kv.set(k, v);
        }
      }
      const token = kv.get('cursorAuth/accessToken') ?? null;
      const plan = kv.get('cursorAuth/stripeMembershipType') ?? null;
      if (verbose) {
        log.appendLine(
          `[token] cursorAuth/accessToken ${token ? maskToken(token) : '(missing)'}`,
        );
        log.appendLine(
          `[token] cursorAuth/stripeMembershipType ${plan ?? '(missing)'}`,
        );
      }
      lastAuthSnapshot = { accessToken: token, planLabel: plan, readAt: Date.now() };
      return { accessToken: token, planLabel: plan };
    } finally {
      db.close();
    }
  } catch (err) {
    if (verbose) {
      log.appendLine(`[token] sql.js error: ${err instanceof Error ? err.message : String(err)}`);
      if (lastAuthSnapshot?.accessToken && Date.now() - lastAuthSnapshot.readAt < AUTH_FALLBACK_TTL_MS) {
        log.appendLine('[token] using last successful auth snapshot due to DB read failure');
      }
    }
    if (lastAuthSnapshot?.accessToken && Date.now() - lastAuthSnapshot.readAt < AUTH_FALLBACK_TTL_MS) {
      return {
        accessToken: lastAuthSnapshot.accessToken,
        planLabel: lastAuthSnapshot.planLabel,
      };
    }
    return { accessToken: null, planLabel: null };
  }
}

async function getSqlRuntime(): Promise<{
  Database: new (data?: Uint8Array) => { exec: (sql: string) => Array<{ values: unknown[][] }>; close: () => void };
}> {
  if (!sqlRuntimePromise) {
    sqlRuntimePromise = Promise.resolve(initSqlJs()) as Promise<{
      Database: new (data?: Uint8Array) => { exec: (sql: string) => Array<{ values: unknown[][] }>; close: () => void };
    }>;
  }
  return sqlRuntimePromise;
}

/**
 * Connect JSON expects `Authorization: Bearer <JWT>` (same value as in state.vscdb).
 * Cookie-based WorkosCursorSessionToken is rejected by this RPC (401 / unauthenticated).
 */
async function fetchUsage(token: string, verbose: boolean): Promise<unknown> {
  let lastErr: Error | undefined;
  if (verbose) {
    log.appendLine('');
    log.appendLine(
      `──────── ${new Date().toISOString()} POST ${CONNECT_PATH} (Bearer ${maskToken(token)}) ────────`,
    );
  }
  for (const host of HOSTS) {
    if (verbose) {
      log.appendLine(`[attempt] https://${host}${CONNECT_PATH}`);
    }
    try {
      const data = await connectPost(host, token, verbose);
      if (verbose) {
        log.appendLine(`[attempt] success via ${host}`);
      }
      return data;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (verbose) {
        log.appendLine(`[attempt] failed ${host}: ${lastErr.message}`);
      }
    }
  }
  throw lastErr ?? new Error('request failed');
}

/**
 * If access token expired, Cursor may rotate token in state.vscdb shortly after.
 * Re-read and retry once before surfacing a re-auth status.
 */
async function fetchUsageWithTokenRefresh(initialToken: string, verbose: boolean): Promise<unknown> {
  try {
    return await fetchUsage(initialToken, verbose);
  } catch (e) {
    const first = e instanceof Error ? e : new Error(String(e));
    if (!isAuthFailure(first.message)) {
      throw first;
    }
    if (verbose) {
      log.appendLine(`[auth] auth failure detected; attempting token reload`);
    }

    await delay(750);
    const rotated = (await readAuthMeta(verbose, true)).accessToken;
    if (!rotated) {
      throw new Error('auth expired: token unavailable; sign in again');
    }
    if (rotated.trim() === initialToken.trim()) {
      throw new Error('auth expired: token unchanged; sign in again');
    }
    if (verbose) {
      log.appendLine(`[auth] reloaded token ${maskToken(rotated)}; retrying request`);
    }
    try {
      return await fetchUsage(rotated, verbose);
    } catch (e2) {
      const second = e2 instanceof Error ? e2 : new Error(String(e2));
      if (isAuthFailure(second.message)) {
        throw new Error('auth expired after refresh; sign in again');
      }
      throw second;
    }
  }
}

function isAuthFailure(msg: string): boolean {
  const s = msg.toLowerCase();
  return (
    s.includes('http 401') ||
    s.includes('http 403') ||
    s.includes('unauth') ||
    s.includes('forbidden') ||
    s.includes('jwt') ||
    s.includes('token expired') ||
    s.includes('invalid token') ||
    s.includes('permission_denied')
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectPost(host: string, bearerToken: string, verbose: boolean): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const body = '{}';
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      'Connect-Protocol-Version': '1',
      'Content-Length': Buffer.byteLength(body),
      Authorization: `Bearer ${bearerToken.trim()}`,
      'User-Agent': 'Cursor-Usage-Counter/0.4',
    };
    if (verbose) {
      log.appendLine(`[request] headers: ${JSON.stringify({ ...headers, Authorization: `Bearer ${maskToken(bearerToken)}` }, null, 2)}`);
      log.appendLine(`[request] body: ${body}`);
    }
    const req = https.request(
      {
        hostname: host,
        path: CONNECT_PATH,
        method: 'POST',
        timeout: 20000,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          if (verbose) {
            const rh = { ...res.headers };
            log.appendLine(`[response] HTTP ${res.statusCode} ${res.statusMessage ?? ''}`);
            log.appendLine(`[response] headers: ${JSON.stringify(rh, null, 2)}`);
            log.appendLine(`[response] body length: ${data.length}`);
            log.appendLine(`[response] body (raw):\n${data}`);
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`));
            return;
          }
          try {
            const o = JSON.parse(data) as Record<string, unknown>;
            if (verbose) {
              try {
                log.appendLine(`[response] body (parsed JSON):\n${JSON.stringify(o, null, 2)}`);
              } catch {
                log.appendLine('[response] could not re-stringify parsed JSON');
              }
            }
            if (typeof o.code === 'string' && 'message' in o) {
              reject(new Error(`${o.code}: ${String(o.message)}`));
              return;
            }
            resolve(o);
          } catch {
            reject(new Error(`bad JSON: ${data.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('error', (err) => {
      if (verbose) {
        log.appendLine(`[request] socket error: ${err.message}`);
      }
      reject(err);
    });
    req.on('timeout', () => {
      req.destroy();
      if (verbose) {
        log.appendLine('[request] timeout after 20s');
      }
      reject(new Error('timeout'));
    });
    req.write(body);
    req.end();
  });
}

function cursorDb(): string | null {
  const h = os.homedir();
  switch (os.platform()) {
    case 'win32':
      return path.join(h, 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    case 'darwin':
      return path.join(h, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    default:
      return path.join(h, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
}
