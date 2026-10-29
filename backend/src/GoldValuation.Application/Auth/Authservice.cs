using GoldValuation.Application.Abstractions;

namespace GoldValuation.Application.Auth;

/// <summary>Sign in, keep the session alive, sign out. Knows the rules; the store, hasher and token issuer do the plumbing.</summary>
public sealed class AuthService(IAuthStore store, IPasswordHasher hasher, IAccessTokenIssuer tokens, IClock clock, AuthSettings settings)
{
    public const string InvalidCredentials = "INVALID_CREDENTIALS";
    public const string SessionExpired = "SESSION_EXPIRED";
    public const string RefreshInProgress = "REFRESH_IN_PROGRESS";

    // One message for every sign-in failure (wrong name, wrong password, locked, switched off), so it cannot be used to find out who has an account.
    private static AppException Rejected() =>
        new(InvalidCredentials, "Wrong username or password, or the account is temporarily locked.", 401);

    public async Task<SessionResult> LoginAsync(LoginCommand cmd, ClientInfo client, CancellationToken ct)
    {
        var fields = new Dictionary<string, string[]>();
        var username = cmd.Username?.Trim();
        if (string.IsNullOrEmpty(username)) fields["username"] = ["Enter your username."];
        else if (username.Length > 64) fields["username"] = ["That username is too long."];
        if (string.IsNullOrEmpty(cmd.Password)) fields["password"] = ["Enter your password."];
        else if (cmd.Password.Length > 128) fields["password"] = ["That password is too long."];
        if (fields.Count > 0) throw AppException.Invalid("Check the highlighted fields.", fields);

        var company = string.IsNullOrWhiteSpace(cmd.Company) ? settings.DefaultCompany : cmd.Company.Trim();
        var tenantId = string.IsNullOrEmpty(company) ? null : await store.FindTenantAsync(company, ct);
        if (tenantId is null)
        {
            hasher.SpendTime(cmd.Password!);
            throw Rejected();
        }
        var tenant = tenantId.Value;

        var user = await store.FindLoginUserAsync(tenant, username!, ct);
        if (user is null)
        {
            hasher.SpendTime(cmd.Password!);
            await store.AuditAsync(tenant, null, "auth.login_failed", "user", username!, client, ct);
            throw Rejected();
        }

        var now = clock.UtcNow;
        var locked = user.LockedUntil is { } until && until > now;
        var check = hasher.Verify(cmd.Password!, user.PasswordHash);   // always run it: same cost whether or not the account is locked

        if (!user.IsActive || locked || !check.Ok)
        {
            if (user.IsActive && !locked)
                await store.RecordLoginFailureAsync(tenant, user.Id, settings.MaxFailedLogins, now.AddMinutes(settings.LockoutMinutes), ct);
            await store.AuditAsync(tenant, user.Id, locked ? "auth.login_blocked_locked" : "auth.login_failed", "user", user.Id.ToString(), client, ct);
            throw Rejected();
        }

        await store.RecordLoginSuccessAsync(tenant, user.Id, now, check.NeedsRehash ? hasher.Hash(cmd.Password!) : null, ct);
        var session = await store.LoadSessionUserAsync(tenant, user.Id, ct) ?? throw Rejected();

        var refresh = RefreshTokens.Create(tenant);
        var refreshExpires = now.AddDays(settings.RefreshTokenDays);
        await store.StartRefreshFamilyAsync(tenant, user.Id, RefreshTokens.Hash(refresh), refreshExpires, client, ct);
        await store.AuditAsync(tenant, user.Id, "auth.login", "user", user.Id.ToString(), client, ct);

        return new SessionResult(tokens.Issue(tenant, session), session, refresh, refreshExpires);
    }

    public async Task<SessionResult> RefreshAsync(string? cookieValue, ClientInfo client, CancellationToken ct)
    {
        if (!RefreshTokens.TryGetTenant(cookieValue, out var tenant)) throw Expired();

        var next = RefreshTokens.Create(tenant);
        var expires = clock.UtcNow.AddDays(settings.RefreshTokenDays);
        var result = await store.RotateRefreshTokenAsync(tenant, RefreshTokens.Hash(cookieValue!), RefreshTokens.Hash(next), expires, client, ct);

        switch (result.Outcome)
        {
            case RefreshOutcome.Ok:
                var session = await store.LoadSessionUserAsync(tenant, result.UserId!.Value, ct) ?? throw Expired();
                return new SessionResult(tokens.Issue(tenant, session), session, next, expires);

            case RefreshOutcome.Race:
                // Another tab refreshed a moment ago and already holds the new cookie. Nothing is revoked; the caller just asks again.
                throw new AppException(RefreshInProgress, "The session was just refreshed. Try again.", 409);

            case RefreshOutcome.Reused:
                await store.AuditAsync(tenant, result.UserId, "auth.refresh_reuse_detected", "user", result.UserId?.ToString() ?? "-", client, ct);
                throw Expired();

            default:
                throw Expired();
        }
    }

    public async Task LogoutAsync(string? cookieValue, ClientInfo client, CancellationToken ct)
    {
        if (!RefreshTokens.TryGetTenant(cookieValue, out var tenant)) return;
        await store.RevokeRefreshFamilyAsync(tenant, RefreshTokens.Hash(cookieValue!), ct);
        await store.AuditAsync(tenant, null, "auth.logout", "session", "-", client, ct);
    }

    public async Task<SessionUser> MeAsync(ICurrentContext me, CancellationToken ct) =>
        await store.LoadSessionUserAsync(me.TenantId, me.UserId, ct) ?? throw new AppException("UNAUTHENTICATED", "Please sign in again.", 401);

    public Task<IReadOnlyList<BranchInfo>> BranchesAsync(ICurrentContext me, CancellationToken ct) =>
        store.ListBranchesAsync(me.TenantId, me.UserId, ct);

    public Task<IReadOnlyList<BranchInfo>> AllBranchesAsync(ICurrentContext me, CancellationToken ct) =>
        store.ListAllBranchesAsync(me.TenantId, me.UserId, ct);

    private static AppException Expired() => new(SessionExpired, "Your session has ended. Please sign in again.", 401);
}