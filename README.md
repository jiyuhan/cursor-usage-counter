# Cursor Usage Counter

Lightweight Cursor extension that shows your current usage directly in the status bar, with separate indicators for included pools and on-demand spend.

## What It Shows

- `📊` Included total %
- `🤖` Auto + Composer %
- `🔌` API %
- `$` On-demand spend for the current cycle

Each metric is rendered as its own status bar item so colors and hover details are independent.

## Color Rules

- Percent metrics (`📊`, `🤖`, `🔌`)
  - `< 70%` good
  - `< 92%` warning
  - `>= 92%` high
- On-demand spend (`$`)
  - `< $50` good
  - `< $200` warning
  - `>= $200` high

Colors use a softer pastel palette with light/dark-aware contrast tuning.

## Hover Tooltips

- `📊`, `🤖`, `🔌`: label, rounded usage %, and status
- `$`: on-demand amount, account plan, and status

Plan is resolved from local Cursor auth metadata (`cursorAuth/stripeMembershipType`) with API payload parsing as fallback.

## Example Scenarios

These are typical combinations you might see in the status bar:

- **Low usage, low spend (all good)**  
  `📊 24% · 🤖 12% · 🔌 31% · $18.40`  
  All items render in green.

- **API getting close to limit**  
  `📊 51% · 🤖 20% · 🔌 88% · $42.10`  
  `🔌` shifts to warning (yellow), others remain green.

- **API exhausted, spend still modest**  
  `📊 63% · 🤖 27% · 🔌 100% · $49.90`  
  `🔌` turns high (red), `$` remains green.

- **Spend warning, pools still healthy**  
  `📊 45% · 🤖 16% · 🔌 52% · $127.35`  
  `%` items remain green while `$` turns warning (yellow).

- **High spend and high usage**  
  `📊 94% · 🤖 71% · 🔌 100% · $244.80`  
  Most items are high (red), with quick visual priority on `🔌` and `$`.

- **Missing breakdown from API**  
  `📊 38% · $27.40`  
  If Cursor omits Auto/Composer/API split fields, total + spend still render.

## Auth + Data Source

- Reads `cursorAuth/accessToken` from Cursor's local `state.vscdb`
- Calls Cursor Connect endpoint:
  - `/aiserver.v1.DashboardService/GetCurrentPeriodUsage`
  - hosts: `api2.cursor.sh`, `api3.cursor.sh`
- Automatically retries once with a refreshed token if auth expires

## Commands

- `Cursor Usage: Refresh`
- `Cursor Usage: Open Settings`
- `Cursor Usage: Show Log`

## Settings

- `cursorUsageCounter.refreshIntervalSeconds` (default `30`, minimum `10`)
- `cursorUsageCounter.statusBarPriority` (default `-1000`)
- `cursorUsageCounter.logApiResponses` (default `false`)

## Local Development

```bash
npm install
npm run compile
npm test
```

Then run the extension in the Extension Development Host (`F5` in VS Code/Cursor).

## Package / Publish

Build a VSIX:

```bash
npm run vsix
```

Before publishing to Marketplace:

- Set a real `publisher` in `package.json`
- Bump `version` in `package.json`
- Ensure assets/metadata are ready (`README`, icon, changelog if needed)
- Run `npm run compile && npm test`
