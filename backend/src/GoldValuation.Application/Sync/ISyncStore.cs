using GoldValuation.Application.Abstractions;

namespace GoldValuation.Application.Sync;

/// <summary>Who made an offline command, and what they may do now.</summary>
public sealed record SyncAuthor(bool Active, IReadOnlySet<string> Permissions);

/// <summary>Persistence for offline sync (database functions of migration 0048). Results are contract-shaped JSON text.</summary>
public interface ISyncStore
{
    Task<string> RegisterDeviceAsync(ICurrentContext me, string json, CancellationToken ct);
    /// <summary>The public key a person registered for a device (base64 SPKI), or null.</summary>
    Task<string?> DeviceKeyAsync(Guid tenantId, Guid userId, string deviceId, CancellationToken ct);
    Task<SyncAuthor?> AuthorAsync(Guid tenantId, Guid userId, CancellationToken ct);
    /// <summary>Runs one command as that person and returns the recorded result.</summary>
    Task<string> ApplyAsync(Guid tenantId, Guid userId, string json, CancellationToken ct);
    Task<string> ReviewAsync(ICurrentContext me, CancellationToken ct);
    Task<string> ResolveAsync(ICurrentContext me, string json, CancellationToken ct);
}

/// <summary>Checks that a command was signed by the private key matching a registered public key.</summary>
public interface ICommandVerifier
{
    bool Verify(string publicKeySpkiBase64, byte[] data, byte[] signature);
}