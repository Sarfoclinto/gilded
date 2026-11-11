using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.People;

namespace GoldValuation.Api.Endpoints;

/// <summary>Users, roles, customers and branches, plus the signed-in person's own password.</summary>
public static class PeopleEndpoints
{
    private static IResult Data(string json, int status = 200) => new RawJsonResult(status, $"{{\"data\":{json}}}");
    private static IResult Created(GoldValuation.Application.Operations.DbResult r) => Data(r.DataJson, r.Replayed ? 200 : 201);
    private static string? Key(HttpContext http) => http.Request.Headers["Idempotency-Key"].FirstOrDefault();

    public static RouteGroupBuilder MapPeople(this RouteGroupBuilder api)
    {
        // ---- users ----
        api.MapGet("/users", async (ICurrentContext me, PeopleService svc, CancellationToken ct) => Data(await svc.ListUsersAsync(me, ct)));
        api.MapGet("/roles", async (ICurrentContext me, PeopleService svc, CancellationToken ct) => Data(await svc.ListRolesAsync(me, ct)));
        api.MapPost("/roles", async (CreateRoleCommand body, HttpContext http, ICurrentContext me, PeopleService svc, CancellationToken ct) =>
            Created(await svc.CreateRoleAsync(me, body, Key(http), ct)));
        api.MapPatch("/roles/{key}", async (string key, JsonObject body, ICurrentContext me, PeopleService svc, CancellationToken ct) =>
            Data(await svc.UpdateRoleAsync(me, key, body, ct)));
        api.MapDelete("/roles/{key}", async (string key, ICurrentContext me, PeopleService svc, CancellationToken ct) =>
        {
            await svc.DeleteRoleAsync(me, key, ct);
            return Results.NoContent();
        });
        api.MapPost("/users", async (CreateUserCommand body, HttpContext http, ICurrentContext me, PeopleService svc, CancellationToken ct) =>
            Created(await svc.CreateUserAsync(me, body, Key(http), ct)));
        api.MapPatch("/users/{id:guid}", async (Guid id, JsonObject body, ICurrentContext me, PeopleService svc, CancellationToken ct) =>
            Data(await svc.UpdateUserAsync(me, id, body, ct)));
        api.MapPost("/users/{id:guid}/password", async (Guid id, PasswordCommand body, ICurrentContext me, PeopleService svc, CancellationToken ct) =>
            Data(await svc.ResetPasswordAsync(me, id, body, ct)));

        // ---- my own password ----
        api.MapGet("/me/security", async (ICurrentContext me, PeopleService svc, CancellationToken ct) => Data(await svc.MySecurityAsync(me, ct)));
        api.MapPost("/me/password", async (ChangePasswordCommand body, ICurrentContext me, PeopleService svc, CancellationToken ct) =>
        {
            await svc.ChangeMyPasswordAsync(me, body, ct);
            return Results.NoContent();
        });

        // ---- customers ----
        api.MapGet("/customers/list", async (string? q, string? filter, string? sort, int? limit, int? offset, ICurrentContext me, PeopleService svc, CancellationToken ct) =>
            Data(await svc.ListCustomersAsync(me, q, filter, sort, limit, offset, ct)));
        api.MapGet("/customers/{id:guid}", async (Guid id, ICurrentContext me, PeopleService svc, CancellationToken ct) =>
            Data(await svc.GetCustomerAsync(me, id, ct)));
        api.MapPost("/customers", async (CreateCustomerCommand body, HttpContext http, ICurrentContext me, PeopleService svc, CancellationToken ct) =>
            Created(await svc.CreateCustomerAsync(me, body, Key(http), ct)));
        api.MapPatch("/customers/{id:guid}", async (Guid id, JsonObject body, ICurrentContext me, PeopleService svc, CancellationToken ct) =>
            Data(await svc.UpdateCustomerAsync(me, id, body, ct)));
        api.MapPost("/customers/{id:guid}/merge", async (Guid id, MergeCustomersCommand body, ICurrentContext me, PeopleService svc, CancellationToken ct) =>
            Data(await svc.MergeCustomersAsync(me, id, body, ct)));

        // ---- branches (administration; GET /branches stays the list of branches the caller works in) ----
        api.MapGet("/branches/manage", async (ICurrentContext me, PeopleService svc, CancellationToken ct) => Data(await svc.ListBranchesAsync(me, ct)));
        api.MapPost("/branches", async (CreateBranchCommand body, HttpContext http, ICurrentContext me, PeopleService svc, CancellationToken ct) =>
            Created(await svc.CreateBranchAsync(me, body, Key(http), ct)));
        api.MapGet("/branches/{id:guid}/overview", async (Guid id, ICurrentContext me, PeopleService svc, CancellationToken ct) =>
            Data(await svc.BranchOverviewAsync(me, id, ct)));
        api.MapGet("/cash/overview", async (Guid? branchId, ICurrentContext me, PeopleService svc, CancellationToken ct) =>
            Data(await svc.CashOverviewAsync(me, branchId, ct)));
        api.MapGet("/accounts/live", async (Guid branchId, ICurrentContext me, PeopleService svc, CancellationToken ct) =>
            Data(await svc.LiveAccountAsync(me, branchId, ct)));
        api.MapGet("/accounts/daily", async (Guid? branchId, string? date, ICurrentContext me, PeopleService svc, CancellationToken ct) =>
            Data(await svc.DailyAccountsAsync(me, branchId, date, ct)));
        api.MapGet("/audit", async (HttpContext http, ICurrentContext me, PeopleService svc, CancellationToken ct) =>
            Data(await svc.AuditSearchAsync(me, http.Request.Query.ToDictionary(q => q.Key, q => (string?)q.Value.ToString()), ct)));
        api.MapPatch("/branches/{id:guid}", async (Guid id, JsonObject body, ICurrentContext me, PeopleService svc, CancellationToken ct) =>
            Data(await svc.UpdateBranchAsync(me, id, body, ct)));
        return api;
    }
}