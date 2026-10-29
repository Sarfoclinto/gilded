using System.Net;

namespace GoldValuation.Application.Auth;

public interface IPasswordHasher
{
    string Hash(string password);
    PasswordCheck Verify(string password, string stored);
    /// <summary>Spends the same time as a real check, so "no such user" is not faster than "wrong password".</summary>
    void SpendTime(string password);
}

public readonly record struct PasswordCheck(bool Ok, bool NeedsRehash);

public interface IAccessTokenIssuer
{
    IssuedAccessToken Issue(Guid tenantId, SessionUser user);
}

/// <summary>Database access for sign-in. Each method is its own transaction, committed before it returns (a failed-login count must survive the error that follows).</summary>
public interface IAuthStore
{
    Task<Guid?> FindTenantAsync(string company, CancellationToken ct);
    Task<LoginUser?> FindLoginUserAsync(Guid tenantId, string username, CancellationToken ct);
    Task RecordLoginFailureAsync(Guid tenantId, Guid userId, int maxFailures, DateTimeOffset lockUntil, CancellationToken ct);
    Task RecordLoginSuccessAsync(Guid tenantId, Guid userId, DateTimeOffset now, string? newPasswordHash, CancellationToken ct);
    Task<SessionUser?> LoadSessionUserAsync(Guid tenantId, Guid userId, CancellationToken ct);
    Task<IReadOnlyList<BranchInfo>> ListBranchesAsync(Guid tenantId, Guid userId, CancellationToken ct);
    /// <summary>Every active branch of the company, for choosing a transfer destination or a sending branch. Names only.</summary>
    Task<IReadOnlyList<BranchInfo>> ListAllBranchesAsync(Guid tenantId, Guid userId, CancellationToken ct);
    Task StartRefreshFamilyAsync(Guid tenantId, Guid userId, byte[] tokenHash, DateTimeOffset expiresAt, ClientInfo client, CancellationToken ct);
    Task<RotationResult> RotateRefreshTokenAsync(Guid tenantId, byte[] oldHash, byte[] newHash, DateTimeOffset expiresAt, ClientInfo client, CancellationToken ct);
    Task RevokeRefreshFamilyAsync(Guid tenantId, byte[] tokenHash, CancellationToken ct);
    Task AuditAsync(Guid tenantId, Guid? actorUserId, string action, string entityType, string entityId, ClientInfo client, CancellationToken ct);
}