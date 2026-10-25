using System.Security.Claims;
using GoldValuation.Application.Abstractions;

namespace GoldValuation.Api.Auth;

/// <summary>Who is calling, read from the verified access token. Nothing here ever comes from the request body.</summary>
public sealed class HttpCurrentContext(IHttpContextAccessor accessor) : ICurrentContext
{
    private ClaimsPrincipal? _user;
    private IReadOnlySet<Guid>? _branches;
    private HashSet<string>? _permissions;

    private ClaimsPrincipal User => _user ??= accessor.HttpContext?.User is { Identity.IsAuthenticated: true } u
        ? u
        : throw new AppException("UNAUTHENTICATED", "Please sign in.", 401);

    public Guid TenantId => Guid.Parse(User.FindFirstValue("tid") ?? throw new AppException("UNAUTHENTICATED", "Please sign in.", 401));
    public Guid UserId => Guid.Parse(User.FindFirstValue("sub") ?? throw new AppException("UNAUTHENTICATED", "Please sign in.", 401));
    public IReadOnlySet<Guid> BranchIds => _branches ??= User.FindAll("branch").Select(c => Guid.Parse(c.Value)).ToHashSet();
    public bool Has(string permission) => (_permissions ??= User.FindAll("perm").Select(c => c.Value).ToHashSet()).Contains(permission);
}

public static class PermissionExtensions
{
    /// <summary>Refuses with 403 unless the caller holds the permission: <c>app.MapPost(...).RequirePermission(Permissions.DaysManage)</c>.</summary>
    public static RouteHandlerBuilder RequirePermission(this RouteHandlerBuilder builder, string permission) =>
        builder.AddEndpointFilter(async (context, next) =>
        {
            var me = context.HttpContext.RequestServices.GetRequiredService<ICurrentContext>();
            if (!me.Has(permission)) throw AppException.Forbidden();
            return await next(context);
        });
}
