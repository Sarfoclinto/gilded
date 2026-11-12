# B7d: Automatic GoldBod price

Setup → **Automatic price** (directors; needs `prices:approve`).

## What it does
- The API reads GoldBod's "Local Gold Prices for Today" block (the price is part of the page's own text, there is no separate data request) at the times a director chooses, and records **Total Price Per Pound** as the new reference price (source: goldbod).
- **When to look** are *check windows*: from a start to an end, every N minutes, on chosen weekdays. Inside a window it looks until the new price arrives and then stops until the next window. Ready-made sets: GoldBod times (10:30–11:30 and 15:00–16:00), Earlier times (09:30–10:30, 14:30–15:30), Wide net, All working day. Or your own, up to 6 windows.
- **Margins:** by default each branch's margin is carried onto the new price as *provisional* and managers who can approve prices are notified ("A margin for X is waiting for approval"). Tellers keep buying at that margin meanwhile. Optionally, approved margins stay approved.
- **Safety:** the page also shows the LBMA price and the exchange rate, so the app works the cedi price out itself (LBMA × rate × (7.75 g ÷ 31.1035) × 23/24, using your own company constants). If the page's figure is more than 1.5% off that, or the price is more than 10% (adjustable) away from the current one, it is **held**: nothing changes, directors are notified, and a director chooses *Use this price* or *Dismiss*. If the page can't be read (redesigned, site down) it records one failure and notifies directors; you can always type a price by hand on the Prices page.
- Buttons: *See what the page says now* (reads and shows, saves nothing) and *Check and use it now*.
- The automatic price is recorded under the name of the director who last saved the settings.

## Run first
1. `backend/db/migrations/0023_price_feed.sql`: `dotnet run --project src/GoldValuation.Api -- migrate`
2. The API server must be able to reach `https://goldbod.gov.gh/` (outbound HTTPS). The address is in `appsettings.json` → `PriceFeed:Url`.
3. Open Setup → Automatic price, pick the times, **See what the page says now**, then switch it on and Save.

## Files
| File | Goes to |
|---|---|
| 0023_price_feed.sql | backend/db/migrations/ |
| 017_price_feed.sql | backend/db/tests/ |
| GoldbodPageParser.cs, FeedLogic.cs, IPriceFeedStore.cs, PriceFeedService.cs | backend/src/GoldValuation.Application/PriceFeed/ (new) |
| GoldbodHttpClient.cs, PostgresPriceFeedStore.cs | backend/src/GoldValuation.Infrastructure/PriceFeed/ (new) |
| InfrastructureModule.cs | backend/src/GoldValuation.Infrastructure/ (replace) |
| PriceFeedWorker.cs | backend/src/GoldValuation.Api/ (new) |
| PriceFeedEndpoints.cs | backend/src/GoldValuation.Api/Endpoints/ (new) |
| Program.cs, appsettings.json | backend/src/GoldValuation.Api/ (replace) |
| PriceFeedTests.cs | backend/tests/GoldValuation.Infrastructure.Tests/ (new) |
| api.ts, presets.ts, presets.test.ts | web/src/features/pricefeed/ (new) |
| PriceFeedPage.tsx | web/src/features/pricefeed/pages/ (new) |
| paths.ts, routes.tsx, menu.tsx | replace (route and menu entry) |
| openapi.yaml (0.14.0), 03-roadmap.md | docs/ |

## NOT tested here, and how to test
- **The page reader against the live site.** I could not open goldbod.gov.gh from my workspace; the reader is written from the text of the modal (your screenshot and the page text I could fetch) and tested against that text, not the live HTML. **First thing to do: press "See what the page says now".** If it finds the price, we're good. If it says it was not found, copy the "what the page said" text (or View Source → search for "Total Price Per Pound") and send it to me and I will adjust the reader. Also check it works when the popup is only rendered by JavaScript: if the server sees no price while your browser does, tell me, and we'll use another route (e.g. a headless browser, or entering the price from a daily message).
- **The C#** (no dotnet here): `dotnet test`. `PriceFeedTests` covers the reader, the 1.5%/10% checks, the schedule windows and the service.
- **The worker end to end:** save settings with a window around the current time, watch Recent activity.
- With several API instances, two may look at once; a price already recorded for the same publication time is ignored.
- Note: GoldBod's own rules may restrict automated reading; their notice says prices are published on their website. If they offer an official feed, we should use it instead.