# People slice: users, customers, branches

Paths are from the repo root (`gold-valuation/`). **NEW** means the file does not exist in your project yet: create it at that path.
**CHANGED** means replace the file you already have. No new npm or NuGet packages.

## 0. Do this, in this order

1. Add/replace the backend files (section 1). Then:
   ```
   cd backend/db && ./run-tests.sh          # must end with ALL DATABASE TESTS PASSED
   dotnet test                               # from backend/
   ```
2. Apply the migration (`0014_people.sql`) the way you applied 0013 (the `migrate` command), then **run the same `seed` command you used before**. It is safe to repeat: it only adds the new permissions to the three standard roles and leaves passwords alone.
3. Add/replace the frontend files (section 2), then from `web/`: `npx tsc --noEmit`, `npx vitest run`, `npm run dev`.
4. Sign out and in again (permissions are read at login).

## 1. Backend

| Status | File | Goes in | Next to |
|---|---|---|---|
| NEW | `0014_people.sql` | `backend/db/migrations/` | `0013_pending_payments.sql` |
| NEW | `008_people.sql` | `backend/db/tests/` | `007_pending_payments.sql` |
| NEW | `Commands.cs` | `backend/src/GoldValuation.Application/People/` (new folder) | |
| NEW | `IPeopleStore.cs` | same new folder | |
| NEW | `PeopleService.cs` | same new folder | |
| NEW | `PostgresPeopleStore.cs` | `backend/src/GoldValuation.Infrastructure/People/` (new folder) | |
| NEW | `PeopleEndpoints.cs` | `backend/src/GoldValuation.Api/Endpoints/` | `OperationsEndpoints.cs` |
| NEW | `PeopleServiceTests.cs` | `backend/tests/GoldValuation.Infrastructure.Tests/` | `OperationsServiceTests.cs` |
| CHANGED | `Permissions.cs` | `backend/src/GoldValuation.Application/Auth/` | |
| CHANGED | `InfrastructureModule.cs` | `backend/src/GoldValuation.Infrastructure/` | |
| CHANGED | `Program.cs` | `backend/src/GoldValuation.Api/` (one line: `api.MapPeople();`) | |
| CHANGED | `openapi.yaml` | `docs/` (version 0.5.0) | |
| CHANGED | `03-roadmap.md` | `docs/architecture/` | |

### New permissions (defaults)

| Permission | Teller | Manager | Director |
|---|---|---|---|
| `customers:read` (see customers) | yes | yes | yes |
| `customers:manage` (add, edit, merge) | **no** (grant per person) | yes | yes |
| `users:manage` | no | no | yes |
| `branches:manage` | no | no | yes |

To let one teller edit customers: Users → Edit that person → "Show extra access" → *Add and edit customers* → **Allow**.

### Rules enforced by the database
- Nobody is deleted. Users and branches are switched off; customers are merged (the removed record is kept in the audit trail).
- You cannot change your own role, branches, extra access or switch yourself off. The company always keeps at least one active person who can manage users.
- Changing someone's role, branches, extra access, or switching them off/on **signs them out** (so the change is real at once). Changing only their name, email or phone does not.
- A user created or reset by a director must choose their own password at the next sign-in; nothing else opens until they do.
- Branch code is permanent (it is in every document number). The main branch cannot be switched off; a branch with an open day cannot be switched off.
- Renaming a customer updates the name on their debts; old receipts keep the name used that day.
- Every one of these changes is written to the audit log.

### New endpoints (details in `docs/openapi.yaml`)
`GET/POST /users`, `PATCH /users/{id}`, `POST /users/{id}/password`, `GET /roles`, `GET /me/security`, `POST /me/password`, `GET /customers/list`, `GET/PATCH /customers/{id}`, `POST /customers`, `POST /customers/{id}/merge`, `GET /branches/manage`, `POST /branches`, `PATCH /branches/{id}`.

## 2. Frontend

### 2.1 NEW files (create them)

| File | Goes in |
|---|---|
| `permissionLabels.ts` | `web/src/config/` (next to `permissions.ts`) |
| `ChangePasswordPage.tsx` | `web/src/features/auth/pages/` (next to `LoginPage.tsx`) |
| `schemas.ts`, `api.ts`, `diff.ts`, `diff.test.ts`, `UserModal.tsx`, `ResetPasswordModal.tsx`, `PasswordShownModal.tsx` | `web/src/features/users/` (new folder) |
| `UsersPage.tsx` | `web/src/features/users/pages/` (new folder) |
| `CustomerFormModal.tsx`, `MergeModal.tsx` | `web/src/features/customers/` (next to `api.ts`) |
| `CustomersPage.tsx`, `CustomerDetailPage.tsx` | `web/src/features/customers/pages/` (new folder) |
| `BranchModal.tsx` | `web/src/features/branches/` (next to `api.ts`) |
| `BranchesPage.tsx` | `web/src/features/branches/pages/` (new folder) |

### 2.2 CHANGED files (replace)

| File | Folder |
|---|---|
| `permissions.ts`, `paths.ts` | `web/src/config/` |
| `guards.tsx`, `routes.tsx` | `web/src/app/router/` |
| `api.ts` (branches) | `web/src/features/branches/` |
| `api.ts` (customers) | `web/src/features/customers/` |
| `menu.tsx` | `web/src/layouts/` |

## 3. Screens

| Screen | Menu | Who |
|---|---|---|
| **Customers** (search, paged list: purchases, last purchase, owes us, we owe) | Operations → Customers | `customers:read` |
| **Customer detail** (purchases, debts, held gold; Edit; Merge a duplicate) | click a customer | read; edit/merge need `customers:manage` |
| **Users** (add, edit, reset password, switch off/on, extra access) | Setup → Users | `users:manage` (director) |
| **Branches** (add, edit name/time zone, switch off/on) | Setup → Branches | `branches:manage` (director) |
| **My password** | Setup → My password | everyone; opens by itself for a new/reset user |

## 4. Test walkthrough

1. **Director → Users → Add a user**: username `ama`, role Teller, pick Tarkwa. Copy the temporary password shown (shown once).
2. Sign out, sign in as `ama` with it. You land on *Choose your own password*; nothing else opens. Set one. You are in.
3. As `ama`: Customers shows the list but **no** Add/Edit buttons. As director: Users → Edit Ama → extra access → *Add and edit customers* = Allow → Save (Ama is signed out). Sign in as Ama again: Add/Edit now appear.
4. **Customers**: add "Kofi Boateng", then add "Kofi B." with another phone and buy something for him. Open Kofi B. → *Merge a duplicate*… (merge **into** the real Kofi: open Kofi Boateng → Merge → pick Kofi B.). Check purchases, debts and held gold are now under Kofi Boateng.
5. **Branches → Add a branch** `OBU` Obuasi. Follow the three steps in the dialog (assign staff, set margin, open first day). Note: sign out/in once as director to work inside the new branch.
6. Try the refusals: switch yourself off, change your own role (buttons are hidden / server refuses); switch off the main branch; add a duplicate username; wrong current password on *My password*.

## 5. What was and was not tested
- SQL: 40-odd new assertions in `008_people.sql` pass (creating/editing users, sign-out on access change, last-director rule, passwords, customers create/edit/merge with purchases, debts and held gold following, branches). All earlier tests still pass.
- Frontend: `tsc` clean, 43 unit tests pass, build succeeds. The JSON the new SQL functions produce parses with the new zod schemas.
- **Not tested**: the C# (I cannot compile here; please run `dotnet build` and `dotnet test` and send me any error) and the screens in a browser.

## 6. Known limits
- A director sees a **new branch** in lists at once but can only work in it after signing out and in (branch access is read from the sign-in token).
- Roles are the three standard ones; a role/permission editor is not built (per-person extra access covers one-off cases). Say if you need custom roles.
- Customer delete does not exist by design (merge instead).