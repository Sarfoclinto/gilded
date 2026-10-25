namespace GoldValuation.Application.Abstractions;

public static class ContextExtensions
{
    /// <summary>Refuses with 403 unless the caller holds the permission.</summary>
    public static void Require(this ICurrentContext me, string permission)
    {
        if (!me.Has(permission)) throw AppException.Forbidden();
    }

    /// <summary>Refuses with 403 unless the caller works in that branch.</summary>
    public static void RequireBranch(this ICurrentContext me, Guid branchId)
    {
        if (!me.BranchIds.Contains(branchId))
            throw new AppException("BRANCH_NOT_ASSIGNED", "You are not assigned to this branch.", 403);
    }
}
