using System.Net;

namespace GoldValuation.Application.Auth;

/// <summary>Sign-in tuning. Bound from the "Auth" configuration section.</summary>
public sealed class AuthSettings
{
    public int AccessTokenMinutes { get; set; } = 15;
    public int RefreshTokenDays { get; set; } = 14;
    public int MaxFailedLogins { get; set; } = 5;
    public int LockoutMinutes { get; set; } = 15;
    /// <summary>The company short name used when the sign-in form does not ask for one (single-company deployments).</summary>
    public string? DefaultCompany { get; set; }
    public string Issuer { get; set; } = "gold-valuation";
    public string Audience { get; set; } = "gold-valuation-web";
    /// <summary>At least 32 characters. Never commit a real one: use user-secrets or an environment variable.</summary>
    public string SigningKey { get; set; } = string.Empty;
    public string RefreshCookieName { get; set; } = "gv_refresh";
    /// <summary>Lax, Strict or None. None requires HTTPS.</summary>
    public string CookieSameSite { get; set; } = "Lax";
    public bool CookieSecure { get; set; } = true;
}

public sealed record LoginCommand(string? Username, string? Password, string? Company);

public sealed record ClientInfo(IPAddress? Ip, string? UserAgent, string? TraceId);

public sealed record SessionUser(
    Guid Id, string Username, string DisplayName, string Role,
    IReadOnlyList<string> Permissions, IReadOnlyList<Guid> BranchIds);

public sealed record BranchInfo(Guid Id, string Name, string Code, bool IsMain);

public sealed record IssuedAccessToken(string Token, DateTimeOffset ExpiresAt);

/// <summary>What a successful sign-in or refresh returns. The refresh value goes into an httpOnly cookie, never into the body.</summary>
public sealed record SessionResult(
    IssuedAccessToken AccessToken, SessionUser User, string RefreshTokenValue, DateTimeOffset RefreshExpiresAt);

/// <summary>A row of gold.users as sign-in needs it.</summary>
public sealed record LoginUser(
    Guid Id, string Username, string DisplayName, string PasswordHash, bool IsActive, DateTimeOffset? LockedUntil, string RoleKey);

public enum RefreshOutcome { Ok, Unknown, Revoked, Expired, Race, Reused }

public sealed record RotationResult(RefreshOutcome Outcome, Guid? UserId, Guid? FamilyId);
