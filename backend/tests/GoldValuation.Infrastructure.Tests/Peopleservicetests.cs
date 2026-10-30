using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;
using GoldValuation.Application.Operations;
using GoldValuation.Application.People;
using Xunit;

namespace GoldValuation.Infrastructure.Tests;

public class PeopleServiceTests
{
    private static readonly Guid Tarkwa = Guid.Parse("22222222-2222-4222-8222-222222222222");
    private readonly FakeStore _store = new();
    private readonly PeopleService _svc;

    public PeopleServiceTests() => _svc = new PeopleService(_store, new FakeHasher());

    private static Ctx Teller() => new([Permissions.CustomersRead]);
    private static Ctx Manager() => new([Permissions.CustomersRead, Permissions.CustomersManage]);
    private static Ctx Director() => new([Permissions.UsersManage, Permissions.BranchesManage, Permissions.CustomersRead, Permissions.CustomersManage]);

    [Fact]
    public async Task Only_people_who_manage_users_can_see_or_change_users()
    {
        await Assert.ThrowsAsync<AppException>(() => _svc.ListUsersAsync(Manager(), default));
        await Assert.ThrowsAsync<AppException>(() => _svc.ResetPasswordAsync(Manager(), Guid.NewGuid(), new PasswordCommand("a-long-password"), default));
        await _svc.ListUsersAsync(Director(), default);
    }

    [Fact]
    public async Task A_new_users_password_is_hashed_before_it_leaves_the_service()
    {
        var id = Guid.NewGuid();
        await _svc.CreateUserAsync(Director(), new CreateUserCommand(id, "ama", "Ama", null, null, "temporary-pass", "teller", [Tarkwa], null), id.ToString(), default);
        Assert.Contains("\"passwordHash\":\"hashed:temporary-pass\"", _store.LastPayload);
        Assert.DoesNotContain("\"password\":", _store.LastPayload);
        Assert.Contains("\"roleKey\":\"teller\"", _store.LastPayload);
    }

    [Fact]
    public async Task Short_passwords_and_mismatched_keys_are_refused()
    {
        var id = Guid.NewGuid();
        var ex = await Assert.ThrowsAsync<AppException>(() => _svc.CreateUserAsync(Director(), new CreateUserCommand(id, "ama", "Ama", null, null, "short", "teller", [Tarkwa], null), null, default));
        Assert.Equal(422, ex.Status);
        await Assert.ThrowsAsync<AppException>(() => _svc.CreateUserAsync(Director(), new CreateUserCommand(id, "ama", "Ama", null, null, "temporary-pass", "teller", [Tarkwa], null), Guid.NewGuid().ToString(), default));
    }

    [Fact]
    public async Task An_update_passes_on_only_the_fields_that_were_sent()
    {
        await _svc.UpdateUserAsync(Director(), Guid.NewGuid(), JsonNode.Parse("""{"displayName":"New Name","isAdmin":true,"phone":null}""")!.AsObject(), default);
        Assert.Contains("\"displayName\":\"New Name\"", _store.LastPayload);
        Assert.Contains("\"phone\":null", _store.LastPayload);   // sent as null means "clear it"
        Assert.DoesNotContain("isAdmin", _store.LastPayload);
        Assert.DoesNotContain("roleKey", _store.LastPayload);
        await Assert.ThrowsAsync<AppException>(() => _svc.UpdateUserAsync(Director(), Guid.NewGuid(), JsonNode.Parse("""{"isAdmin":true}""")!.AsObject(), default));
    }

    [Fact]
    public async Task Changing_your_own_password_needs_the_current_one_and_a_different_new_one()
    {
        _store.MyHash = "hashed:old-password-1";
        var wrong = await Assert.ThrowsAsync<AppException>(() => _svc.ChangeMyPasswordAsync(Teller(), new ChangePasswordCommand("nope-nope-nope", "brand-new-pass-1"), default));
        Assert.Equal("WRONG_PASSWORD", wrong.Code);
        await Assert.ThrowsAsync<AppException>(() => _svc.ChangeMyPasswordAsync(Teller(), new ChangePasswordCommand("old-password-1", "old-password-1"), default));
        await _svc.ChangeMyPasswordAsync(Teller(), new ChangePasswordCommand("old-password-1", "brand-new-pass-1"), default);
        Assert.Equal("hashed:brand-new-pass-1", _store.MyHash);
    }

    [Fact]
    public async Task Customers_can_be_read_by_those_with_read_but_changed_only_with_manage()
    {
        await _svc.ListCustomersAsync(Teller(), "ko", null, null, null, null, default);
        await Assert.ThrowsAsync<AppException>(() => _svc.CreateCustomerAsync(Teller(), new CreateCustomerCommand(null, "Kofi", "0200000001", null), null, default));
        await Assert.ThrowsAsync<AppException>(() => _svc.UpdateCustomerAsync(Teller(), Guid.NewGuid(), JsonNode.Parse("""{"name":"X"}""")!.AsObject(), default));
        await _svc.UpdateCustomerAsync(Manager(), Guid.NewGuid(), JsonNode.Parse("""{"name":"Kofi B"}""")!.AsObject(), default);
        await Assert.ThrowsAsync<AppException>(() => _svc.MergeCustomersAsync(Manager(), Guid.NewGuid(), new MergeCustomersCommand(null), default));
        await _svc.MergeCustomersAsync(Manager(), Guid.NewGuid(), new MergeCustomersCommand(Guid.NewGuid()), default);
    }

    [Fact]
    public async Task Paging_is_kept_within_bounds()
    {
        await _svc.ListCustomersAsync(Manager(), "  ", null, null, 5000, -4, default);
        Assert.Contains("\"q\":null", _store.LastPage);
        Assert.Contains("\"limit\":100", _store.LastPage);
        Assert.Contains("\"offset\":0", _store.LastPage);
        Assert.Contains("\"filter\":\"all\"", _store.LastPage);
        Assert.Contains("\"sort\":\"name\"", _store.LastPage);
    }

    [Fact]
    public async Task Customer_filters_and_sorts_must_be_known_ones()
    {
        await _svc.ListCustomersAsync(Manager(), "kofi", "owes_us", "paid", 10, 20, default);
        Assert.Contains("\"filter\":\"owes_us\"", _store.LastPage);
        Assert.Contains("\"sort\":\"paid\"", _store.LastPage);
        await Assert.ThrowsAsync<AppException>(() => _svc.ListCustomersAsync(Manager(), null, "nope", null, null, null, default));
        await Assert.ThrowsAsync<AppException>(() => _svc.ListCustomersAsync(Manager(), null, null, "sideways", null, null, default));
        await Assert.ThrowsAsync<AppException>(() => _svc.ListCustomersAsync(new Ctx([]), null, null, null, null, null, default));
    }

    [Fact]
    public async Task Branch_administration_needs_its_own_permission()
    {
        await Assert.ThrowsAsync<AppException>(() => _svc.ListBranchesAsync(Manager(), default));
        await _svc.CreateBranchAsync(Director(), new CreateBranchCommand(null, "OBU", "Obuasi", null), null, default);
        Assert.Contains("\"code\":\"OBU\"", _store.LastPayload);
    }

    [Fact]
    public async Task Branch_overview_needs_reports_and_a_branch_the_caller_may_see()
    {
        await Assert.ThrowsAsync<AppException>(() => _svc.BranchOverviewAsync(new Ctx([Permissions.DaysRead]), Tarkwa, default));
        await Assert.ThrowsAsync<AppException>(() => _svc.BranchOverviewAsync(new Ctx([Permissions.ReportsRead]), Guid.NewGuid(), default));
        await _svc.BranchOverviewAsync(new Ctx([Permissions.ReportsRead]), Tarkwa, default);
    }

    [Fact]
    public async Task Cash_overview_is_limited_to_the_callers_branches()
    {
        await Assert.ThrowsAsync<AppException>(() => _svc.CashOverviewAsync(new Ctx([]), null, default));
        await Assert.ThrowsAsync<AppException>(() => _svc.CashOverviewAsync(new Ctx([Permissions.DaysRead]), Guid.NewGuid(), default));
        await _svc.CashOverviewAsync(new Ctx([Permissions.DaysRead]), null, default);
        Assert.Equal([Tarkwa], _store.LastScope);
        await _svc.CashOverviewAsync(new Ctx([Permissions.DaysRead]), Tarkwa, default);
        Assert.Equal(Tarkwa, _store.LastBranch);
    }

    [Fact]
    public void Standard_roles_get_the_new_permissions_as_agreed()
    {
        var roles = Permissions.DefaultRoles;
        Assert.Contains(Permissions.CustomersRead, roles["teller"].Permissions);
        Assert.DoesNotContain(Permissions.CustomersManage, roles["teller"].Permissions);
        Assert.Contains(Permissions.CustomersManage, roles["manager"].Permissions);
        Assert.DoesNotContain(Permissions.BranchesManage, roles["manager"].Permissions);
        Assert.Contains(Permissions.BranchesManage, roles["director"].Permissions);
        Assert.Contains(Permissions.UsersManage, roles["director"].Permissions);
    }

    private sealed class FakeHasher : IPasswordHasher
    {
        public string Hash(string password) => "hashed:" + password;
        public PasswordCheck Verify(string password, string stored) => new(stored == "hashed:" + password, false);
        public void SpendTime(string password) { }
    }

    private sealed class Ctx(IEnumerable<string> permissions) : ICurrentContext
    {
        private readonly HashSet<string> _permissions = permissions.ToHashSet();
        public Guid TenantId => Guid.Parse("33333333-3333-4333-8333-333333333333");
        public Guid UserId => Guid.Parse("aaaaaaaa-0000-4000-8000-000000000001");
        public IReadOnlySet<Guid> BranchIds { get; } = new HashSet<Guid> { Tarkwa };
        public bool Has(string permission) => _permissions.Contains(permission);
    }

    private sealed class FakeStore : IPeopleStore
    {
        public string? LastPayload;
        public string MyHash = "";
        public string? LastPage;
        public IReadOnlyCollection<Guid>? LastScope;
        public Guid? LastBranch;

        public Task<string> ListUsersAsync(ICurrentContext me, CancellationToken ct) => Task.FromResult("[]");
        public Task<string> ListRolesAsync(ICurrentContext me, CancellationToken ct) => Task.FromResult("[]");
        public Task<DbResult> CreateUserAsync(ICurrentContext me, string p, CancellationToken ct) { LastPayload = p; return Task.FromResult(new DbResult(false, "{}")); }
        public Task<string> UpdateUserAsync(ICurrentContext me, Guid id, string p, CancellationToken ct) { LastPayload = p; return Task.FromResult("{}"); }
        public Task<string> ResetPasswordAsync(ICurrentContext me, Guid id, string hash, CancellationToken ct) => Task.FromResult("{}");
        public Task<string> MySecurityAsync(ICurrentContext me, CancellationToken ct) => Task.FromResult("{}");
        public Task<string> MyPasswordHashAsync(ICurrentContext me, CancellationToken ct) => Task.FromResult(MyHash);
        public Task ChangeMyPasswordAsync(ICurrentContext me, string hash, CancellationToken ct) { MyHash = hash; return Task.CompletedTask; }
        public Task<string> ListCustomersAsync(ICurrentContext me, string filterJson, CancellationToken ct) { LastPage = filterJson; return Task.FromResult("{}"); }
        public Task<string> GetCustomerAsync(ICurrentContext me, Guid id, CancellationToken ct) => Task.FromResult("{}");
        public Task<DbResult> CreateCustomerAsync(ICurrentContext me, string p, CancellationToken ct) { LastPayload = p; return Task.FromResult(new DbResult(false, "{}")); }
        public Task<string> UpdateCustomerAsync(ICurrentContext me, Guid id, string p, CancellationToken ct) { LastPayload = p; return Task.FromResult("{}"); }
        public Task<string> MergeCustomersAsync(ICurrentContext me, Guid keep, Guid remove, CancellationToken ct) => Task.FromResult("{}");
        public Task<string> ListBranchesAsync(ICurrentContext me, CancellationToken ct) => Task.FromResult("[]");
        public Task<DbResult> CreateBranchAsync(ICurrentContext me, string p, CancellationToken ct) { LastPayload = p; return Task.FromResult(new DbResult(false, "{}")); }
        public Task<string> UpdateBranchAsync(ICurrentContext me, Guid id, string p, CancellationToken ct) { LastPayload = p; return Task.FromResult("{}"); }
        public Task<string> BranchOverviewAsync(ICurrentContext me, Guid id, CancellationToken ct) => Task.FromResult("{}");
        public Task<string> CashOverviewAsync(ICurrentContext me, IReadOnlyCollection<Guid> scope, Guid? branchId, CancellationToken ct) { LastScope = scope; LastBranch = branchId; return Task.FromResult("{}"); }
    }
}