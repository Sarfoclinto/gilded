using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Operations;

namespace GoldValuation.Application.Transfers;

/// <summary>Persistence for transfers (database functions of migration 0015). Results are contract-shaped JSON text. Each call runs in one transaction.</summary>
public interface ITransfersStore
{
    Task<string> ListAsync(ICurrentContext me, Guid branchId, string? status, string direction, CancellationToken ct);
    Task<string> TransferableItemsAsync(ICurrentContext me, Guid branchId, CancellationToken ct);
    Task<string> StaffAsync(ICurrentContext me, CancellationToken ct);
    Task<string?> GetAsync(ICurrentContext me, Guid id, CancellationToken ct);
    Task<DbResult> CreateAsync(ICurrentContext me, string payloadJson, CancellationToken ct);
    Task<string> EditAsync(ICurrentContext me, Guid id, string payloadJson, CancellationToken ct);
    Task<string> ReleaseAsync(ICurrentContext me, Guid id, string payloadJson, CancellationToken ct);
    Task<string> RecordPaymentAsync(ICurrentContext me, Guid id, string payloadJson, CancellationToken ct);
    Task<string> ReceiveAsync(ICurrentContext me, Guid id, string payloadJson, CancellationToken ct);
    Task<string> CancelAsync(ICurrentContext me, Guid id, string reason, CancellationToken ct);
    Task<string> AddNoteAsync(ICurrentContext me, Guid id, string text, CancellationToken ct);
}
