using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;
using GoldValuation.Application.Operations;

namespace GoldValuation.Application.People;

/// <summary>
/// Managing users, customers and branches. Each method checks who is asking, validates the request and hands a ready payload to the
/// store. Passwords are hashed here, so a plain password never reaches the database or the logs.
/// </summary>
public sealed class PeopleService(IPeopleStore store, IPasswordHasher hasher)
{
    public const int MinPasswordLength = 10;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };
    private static readonly string[] UserFields = ["displayName", "email", "phone", "roleKey", "branchIds", "overrides", "isActive"];
    private static readonly string[] CustomerFields = ["name", "phone", "notes"];
    private static readonly string[] BranchFields = ["name", "timezone", "isActive"];

    // ---------------------------------------------------------------- users
    public Task<string> ListUsersAsync(ICurrentContext me, CancellationToken ct)
    {
        me.Require(Permissions.UsersManage);
        return store.ListUsersAsync(me, ct);
    }

    public Task<string> ListRolesAsync(ICurrentContext me, CancellationToken ct)
    {
        me.Require(Permissions.UsersManage);
        return store.ListRolesAsync(me, ct);
    }

    public Task<DbResult> CreateUserAsync(ICurrentContext me, CreateUserCommand c, string? key, CancellationToken ct)
    {
        me.Require(Permissions.UsersManage);
        KeyMatches(key, c.Id);
        CheckPassword(c.Password, "password");
        var payload = JsonSerializer.SerializeToNode(c with { Password = null }, Json)!.AsObject();
        payload["passwordHash"] = hasher.Hash(c.Password!);
        return store.CreateUserAsync(me, payload.ToJsonString(), ct);
    }

    public Task<string> UpdateUserAsync(ICurrentContext me, Guid id, JsonObject body, CancellationToken ct)
    {
        me.Require(Permissions.UsersManage);
        return store.UpdateUserAsync(me, id, Pick(body, UserFields), ct);
    }

    public Task<string> ResetPasswordAsync(ICurrentContext me, Guid id, PasswordCommand c, CancellationToken ct)
    {
        me.Require(Permissions.UsersManage);
        CheckPassword(c.Password, "password");
        return store.ResetPasswordAsync(me, id, hasher.Hash(c.Password!), ct);
    }

    // ---------------------------------------------------------------- the signed-in person's own password
    public Task<string> MySecurityAsync(ICurrentContext me, CancellationToken ct) => store.MySecurityAsync(me, ct);

    public async Task ChangeMyPasswordAsync(ICurrentContext me, ChangePasswordCommand c, CancellationToken ct)
    {
        CheckPassword(c.NewPassword, "newPassword");
        var stored = await store.MyPasswordHashAsync(me, ct);
        if (string.IsNullOrEmpty(c.CurrentPassword) || !hasher.Verify(c.CurrentPassword, stored).Ok)
            throw new AppException("WRONG_PASSWORD", "The current password is not right.", 422,
                new Dictionary<string, string[]> { ["currentPassword"] = ["The current password is not right."] });
        if (c.CurrentPassword == c.NewPassword)
            throw AppException.Invalid("Choose a password different from the current one.", new Dictionary<string, string[]> { ["newPassword"] = ["Choose a different password."] });
        await store.ChangeMyPasswordAsync(me, hasher.Hash(c.NewPassword!), ct);
    }

    // ---------------------------------------------------------------- customers
    private static readonly string[] CustomerFilters = ["all", "owes_us", "we_owe", "active", "inactive"];
    private static readonly string[] CustomerSorts = ["name", "recent", "purchases", "paid", "owes"];

    public Task<string> ListCustomersAsync(ICurrentContext me, string? query, string? filter, string? sort, int? limit, int? offset, CancellationToken ct)
    {
        me.Require(Permissions.CustomersRead);
        if (filter is not null && !CustomerFilters.Contains(filter)) throw new AppException("VALIDATION_FAILED", "That filter is not known.", 422);
        if (sort is not null && !CustomerSorts.Contains(sort)) throw new AppException("VALIDATION_FAILED", "That sort order is not known.", 422);
        var q = string.IsNullOrWhiteSpace(query) ? null : query.Trim();
        if (q is { Length: > 60 }) q = q[..60];
        var payload = new System.Text.Json.Nodes.JsonObject
        {
            ["q"] = q, ["filter"] = filter ?? "all", ["sort"] = sort ?? "name",
            ["limit"] = Math.Clamp(limit ?? 25, 1, 100), ["offset"] = Math.Max(offset ?? 0, 0),
        };
        return store.ListCustomersAsync(me, payload.ToJsonString(), ct);
    }

    public Task<string> GetCustomerAsync(ICurrentContext me, Guid id, CancellationToken ct)
    {
        me.Require(Permissions.CustomersRead);
        return store.GetCustomerAsync(me, id, ct);
    }

    public Task<DbResult> CreateCustomerAsync(ICurrentContext me, CreateCustomerCommand c, string? key, CancellationToken ct)
    {
        me.Require(Permissions.CustomersManage);
        if (c.Id is { } id) KeyMatches(key, id);
        return store.CreateCustomerAsync(me, JsonSerializer.Serialize(c, Json), ct);
    }

    public Task<string> UpdateCustomerAsync(ICurrentContext me, Guid id, JsonObject body, CancellationToken ct)
    {
        me.Require(Permissions.CustomersManage);
        return store.UpdateCustomerAsync(me, id, Pick(body, CustomerFields), ct);
    }

    public Task<string> MergeCustomersAsync(ICurrentContext me, Guid keepId, MergeCustomersCommand c, CancellationToken ct)
    {
        me.Require(Permissions.CustomersManage);
        if (c.RemoveId is not { } remove || remove == Guid.Empty)
            throw AppException.Invalid("Say which customer to merge into this one.", new Dictionary<string, string[]> { ["removeId"] = ["Choose the duplicate."] });
        return store.MergeCustomersAsync(me, keepId, remove, ct);
    }

    // ---------------------------------------------------------------- branches
    public Task<string> ListBranchesAsync(ICurrentContext me, CancellationToken ct)
    {
        me.Require(Permissions.BranchesManage);
        return store.ListBranchesAsync(me, ct);
    }

    public Task<DbResult> CreateBranchAsync(ICurrentContext me, CreateBranchCommand c, string? key, CancellationToken ct)
    {
        me.Require(Permissions.BranchesManage);
        if (c.Id is { } id) KeyMatches(key, id);
        return store.CreateBranchAsync(me, JsonSerializer.Serialize(c, Json), ct);
    }

    /// <summary>One branch for the administrator: workers, what it holds, what needs attention. Needs reports:read and a branch the caller may see.</summary>
    public Task<string> BranchOverviewAsync(ICurrentContext me, Guid id, CancellationToken ct)
    {
        me.Require(Permissions.ReportsRead);
        me.RequireBranch(id);
        return store.BranchOverviewAsync(me, id, ct);
    }

    /// <summary>
    /// Cash and notes by denomination, as the books hold them now (nothing that is still waiting on a device is in it). A teller sees the
    /// branches they work in; people who may see every branch see them all, or one when `branchId` is given.
    /// </summary>
    public Task<string> CashOverviewAsync(ICurrentContext me, Guid? branchId, CancellationToken ct)
    {
        me.Require(Permissions.DaysRead);
        if (branchId is { } b) me.RequireBranch(b);
        return store.CashOverviewAsync(me, me.BranchIds.ToArray(), branchId, ct);
    }

    public Task<string> UpdateBranchAsync(ICurrentContext me, Guid id, JsonObject body, CancellationToken ct)
    {
        me.Require(Permissions.BranchesManage);
        return store.UpdateBranchAsync(me, id, Pick(body, BranchFields), ct);
    }

    // ---------------------------------------------------------------- helpers
    /// <summary>Only the named fields are passed on, and only the ones present: an absent field means "leave it as it is".</summary>
    internal static string Pick(JsonObject body, string[] allowed)
    {
        var picked = new JsonObject();
        foreach (var name in allowed)
            if (body.TryGetPropertyValue(name, out var value)) picked[name] = value?.DeepClone();
        if (picked.Count == 0) throw AppException.Invalid("Nothing to change.");
        return picked.ToJsonString();
    }

    private static void CheckPassword(string? password, string field)
    {
        if (password is null || password.Length < MinPasswordLength)
            throw AppException.Invalid($"The password must be at least {MinPasswordLength} characters.",
                new Dictionary<string, string[]> { [field] = [$"Use at least {MinPasswordLength} characters."] });
    }

    private static void KeyMatches(string? key, Guid id)
    {
        if (id == Guid.Empty) throw AppException.Invalid("An id is needed.", new Dictionary<string, string[]> { ["id"] = ["Send a new uuid as id."] });
        if (key is not null && !string.Equals(key.Trim(), id.ToString(), StringComparison.OrdinalIgnoreCase))
            throw AppException.Invalid("Idempotency-Key must equal the request's id.");
    }
}