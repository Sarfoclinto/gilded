using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Operations;

namespace GoldValuation.Application.People;

/// <summary>Persistence for managing users, customers and branches (database functions of migration 0014). Results are contract-shaped JSON text.</summary>
public interface IPeopleStore
{
    Task<string> ListUsersAsync(ICurrentContext me, CancellationToken ct);
    Task<string> ListRolesAsync(ICurrentContext me, CancellationToken ct);
    Task<DbResult> CreateUserAsync(ICurrentContext me, string payloadJson, CancellationToken ct);
    Task<string> UpdateUserAsync(ICurrentContext me, Guid id, string payloadJson, CancellationToken ct);
    Task<string> ResetPasswordAsync(ICurrentContext me, Guid id, string passwordHash, CancellationToken ct);

    Task<string> MySecurityAsync(ICurrentContext me, CancellationToken ct);
    Task<string> MyPasswordHashAsync(ICurrentContext me, CancellationToken ct);
    Task ChangeMyPasswordAsync(ICurrentContext me, string passwordHash, CancellationToken ct);

    /// <summary>`filterJson` is { q, filter, sort, limit, offset }, already checked by the service.</summary>
    Task<string> ListCustomersAsync(ICurrentContext me, string filterJson, CancellationToken ct);
    Task<string> GetCustomerAsync(ICurrentContext me, Guid id, CancellationToken ct);
    Task<DbResult> CreateCustomerAsync(ICurrentContext me, string payloadJson, CancellationToken ct);
    Task<string> UpdateCustomerAsync(ICurrentContext me, Guid id, string payloadJson, CancellationToken ct);
    Task<string> MergeCustomersAsync(ICurrentContext me, Guid keepId, Guid removeId, CancellationToken ct);

    Task<string> ListBranchesAsync(ICurrentContext me, CancellationToken ct);
    Task<DbResult> CreateBranchAsync(ICurrentContext me, string payloadJson, CancellationToken ct);
    Task<string> UpdateBranchAsync(ICurrentContext me, Guid id, string payloadJson, CancellationToken ct);
    Task<string> BranchOverviewAsync(ICurrentContext me, Guid id, CancellationToken ct);

    /// <summary>Cash by branch for the cash lookup. `scope` is the branches the caller may see; `branchId` narrows it to one.</summary>
    Task<string> CashOverviewAsync(ICurrentContext me, IReadOnlyCollection<Guid> scope, Guid? branchId, CancellationToken ct);
}