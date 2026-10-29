using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;

namespace GoldValuation.Api.Endpoints;

public static class MeEndpoints
{
    public static RouteGroupBuilder MapMe(this RouteGroupBuilder api)
    {
        api.MapGet("/me", async (ICurrentContext me, AuthService auth, CancellationToken ct) =>
            Results.Ok(new { data = ToDto(await auth.MeAsync(me, ct)) }));

        api.MapGet("/branches", async (ICurrentContext me, AuthService auth, CancellationToken ct) =>
        {
            var branches = await auth.BranchesAsync(me, ct);
            return Results.Ok(new { data = branches.Select(b => new { id = b.Id, name = b.Name, code = b.Code, isMain = b.IsMain }) });
        });

        // Every active branch, names only: for picking where a transfer goes or which branch sends mobile money.
        api.MapGet("/branches/all", async (ICurrentContext me, AuthService auth, CancellationToken ct) =>
        {
            var branches = await auth.AllBranchesAsync(me, ct);
            return Results.Ok(new { data = branches.Select(b => new { id = b.Id, name = b.Name, code = b.Code, isMain = b.IsMain }) });
        });
        return api;
    }

    /// <summary>The contract's User shape (docs/openapi.yaml).</summary>
    public static object ToDto(SessionUser u) => new
    {
        id = u.Id, username = u.Username, displayName = u.DisplayName, role = u.Role,
        permissions = u.Permissions, branchIds = u.BranchIds,
    };
}