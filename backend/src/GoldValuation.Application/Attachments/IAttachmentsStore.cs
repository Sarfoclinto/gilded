using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Operations;

namespace GoldValuation.Application.Attachments;

/// <summary>Persistence for pictures' facts (database functions of migration 0060). Results are contract-shaped JSON text. Each call runs in one transaction.</summary>
public interface IAttachmentsStore
{
    Task<DbResult> AddAsync(ICurrentContext me, string payloadJson, CancellationToken ct);
    Task<string> ListAsync(ICurrentContext me, string entityType, Guid entityId, bool canSeeIds, CancellationToken ct);
    /// <summary>Storage keys and content type of a picture the caller may see, or null when there is none (or it was removed).</summary>
    Task<string?> FileAsync(ICurrentContext me, Guid id, bool canSeeIds, CancellationToken ct);
    /// <summary>The library: one page of pictures the caller may see, as JSON { items, total, page, size }.</summary>
    Task<string> LibraryAsync(ICurrentContext me, string filtersJson, bool canSeeIds, CancellationToken ct);
    Task<Guid?> ProfilePictureAsync(ICurrentContext me, Guid userId, CancellationToken ct);
    Task<string> RemoveAsync(ICurrentContext me, Guid id, string? reason, bool canRemoveAny, bool canSeeIds, CancellationToken ct);
}

/// <summary>Where the picture bytes live. Keys are made by the service, never taken from a request.</summary>
public interface IBlobStore
{
    Task WriteAsync(string key, ReadOnlyMemory<byte> bytes, CancellationToken ct);
    /// <summary>Opens a stored file for reading, or null when it is not there (yet).</summary>
    Stream? Open(string key);
}