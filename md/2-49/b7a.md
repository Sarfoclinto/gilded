# B7a – Live updates and notifications

Apply:

1. `dotnet run --project src/GoldValuation.Api -- migrate` (migration 0019). **No seed change.**
2. In `web`: `npm install` (adds `@microsoft/signalr`), then `npx tsc --noEmit`, `npx vitest run`.
3. `dotnet test`, then run the API and the web app.

## What you get

- **Screens refresh by themselves.** When something changes on the server (a transfer is released or received, a closing, a purchase, a payment, a price, a debt), the screens showing it update without reloading.
- **Notifications.** A bell in the header with an unread count and a list. A small message also pops up when one arrives. Clicking one marks it read and opens the page it is about. People are told: the receiving branch when a transfer is on the way; the sending branch when it is received (with differences or not); reviewers when a difference is opened; managers when a closing needs sign-off; the closer when it was approved or rejected; the paying branch when mobile money must be sent; directors when a margin waits for approval; the branch when the price is updated. The person who caused an event is never notified about it.
- Works because the database itself announces changes (so it holds for every writer), the API listens and relays over a WebSocket. Nothing sensitive travels in the messages: only "this topic changed" or a notification title for that person.
- If the connection drops, the app reconnects by itself and refreshes. Without it, screens behave exactly as before.

## Things to know for deployment (more in B7b)

- Anything in front of the API (nginx, a cloud load balancer) **must allow WebSockets** on `/hubs/live`.
- CORS: the web app's origin must be in `Cors:Origins` (already needed for the API).
- Several API instances work (each listens to the database); to make a message reach clients connected to a _different_ instance you would add a SignalR backplane. One instance needs nothing.

## Backend

- `backend/db/migrations/0019_notifications.sql` (new), `backend/db/tests/013_notifications.sql` (new)
- `backend/src/GoldValuation.Infrastructure/Live/LiveEvent.cs` (new)
- `backend/src/GoldValuation.Api/Live/{LiveHub,EventRelay}.cs` (new)
- `backend/src/GoldValuation.Application/Notifications/{INotificationsStore,NotificationsService}.cs` (new)
- `backend/src/GoldValuation.Infrastructure/Notifications/PostgresNotificationsStore.cs` (new)
- `backend/src/GoldValuation.Api/Endpoints/NotificationsEndpoints.cs` (new)
- `backend/src/GoldValuation.Api/Program.cs`, `backend/src/GoldValuation.Api/Auth/AuthSetup.cs`, `backend/src/GoldValuation.Infrastructure/InfrastructureModule.cs` (changed)
- `backend/tests/GoldValuation.Infrastructure.Tests/{LiveEventTests,NotificationsServiceTests}.cs` (new)
- `docs/openapi.yaml` (0.10.0), `docs/architecture/03-roadmap.md`

## Frontend (`web/`)

- New: `src/shared/live/{liveConnection.ts,liveConnection.test.ts,LiveProvider.tsx}`, `src/features/notifications/{api.ts,NotificationBell.tsx}`
- Changed: `src/layouts/{AppLayout,Header}.tsx`, `package.json`, `package-lock.json`

## Not tested

C# compile and tests (`dotnet test`) and the live connection itself: I could not run the API here, so the WebSocket path (hub, token in the query string, CORS for SignalR, the relay) is untested end to end. The database side is tested, including that the database really emits the NOTIFY message. To check it: open the app in two browsers (a sender at Tarkwa and a receiver at Kumasi), release a transfer in one, and the other should show the bell count and refresh the Transfers list. If nothing arrives, open the browser's network tab, filter "WS", and send me what `/hubs/live` shows.
