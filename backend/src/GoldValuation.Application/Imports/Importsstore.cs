using GoldValuation.Application.Abstractions;
using GoldValuation.Domain.Calculation;

namespace GoldValuation.Application.Imports;

/// <summary>Persistence for data import (database functions of migration 0020). Results are contract-shaped JSON text.</summary>
public interface IImportsStore
{
    Task<CalcConfig> GetCalcConfigAsync(ICurrentContext me, string formulaVersion, CancellationToken ct);
    Task<string> ImportHistoryAsync(ICurrentContext me, string payloadJson, CancellationToken ct);
    Task<string> ImportCustomersAsync(ICurrentContext me, string payloadJson, CancellationToken ct);
    Task<string> ListBatchesAsync(ICurrentContext me, CancellationToken ct);
    Task<string> UndoBatchAsync(ICurrentContext me, Guid batchId, string reason, CancellationToken ct);
}
