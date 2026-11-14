using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;
using GoldValuation.Application.Operations;
using GoldValuation.Domain.Calculation;
using Xunit;

namespace GoldValuation.Infrastructure.Tests;

public class OperationsServiceTests
{
    private static readonly Guid Tarkwa = Guid.Parse("22222222-2222-4222-8222-222222222222");
    private static readonly Guid Kumasi = Guid.Parse("11111111-1111-4111-8111-111111111111");
    private readonly FakeStore _store = new();
    private readonly OperationsService _ops;

    public OperationsServiceTests() => _ops = new OperationsService(_store, new FixedClock());

    private static Ctx Teller() => new([Permissions.TransactionsRead, Permissions.TransactionsCreate, Permissions.DaysRead, Permissions.DaysManage, Permissions.DebtsRead, Permissions.DebtsManage], [Tarkwa]);
    private static Ctx Swapper() => new([.. Teller().Permissions, Permissions.NotesExchange], [Tarkwa]);
    private static Ctx Manager() => new([.. Teller().Permissions, Permissions.KumasiSetValue, Permissions.PaymentsConfirm], [Tarkwa, Kumasi]);

    private static CreateTransactionCommand Purchase(Guid id, Guid branch) => new(id, branch, "Kwesi", null, null,
        [new ItemCommand(Guid.NewGuid(), null, "7.77", "0.41", "11650")], "11832",
        new PayoutCommand("down", "fewest-notes", "11830", new() { ["100"] = 118, ["20"] = 1, ["10"] = 1 }, null),
        new DateTimeOffset(2026, 10, 23, 9, 0, 0, TimeSpan.Zero), new DateTimeOffset(2026, 10, 23, 9, 0, 0, TimeSpan.Zero), null);

    [Fact]
    public async Task Price_history_is_for_a_branch_the_caller_works_in_and_the_period_is_kept_within_bounds()
    {
        await Assert.ThrowsAsync<AppException>(() => _ops.PriceHistoryAsync(Teller(), Guid.NewGuid(), 30, default));
        await _ops.PriceHistoryAsync(Teller(), Tarkwa, null, default);
        Assert.Equal(30, _store.LastHistoryDays);
        await _ops.PriceHistoryAsync(Teller(), Tarkwa, 100000, default);
        Assert.Equal(730, _store.LastHistoryDays);
        await _ops.PriceHistoryAsync(Teller(), Tarkwa, 0, default);
        Assert.Equal(1, _store.LastHistoryDays);
    }

    [Fact]
    public async Task Cancelling_needs_the_permission_a_reason_and_a_purchase_of_the_callers_branch()
    {
        var id = Guid.NewGuid();
        _store.StoredTransaction = $"{{\"id\":\"{id}\",\"branchId\":\"{Tarkwa}\"}}";
        var canceller = new Ctx([.. Teller().Permissions, Permissions.TransactionsCancel], [Tarkwa]);
        await Assert.ThrowsAsync<AppException>(() => _ops.CancelTransactionAsync(Teller(), id, new CancelTransactionCommand("Wrong customer"), default));
        await Assert.ThrowsAsync<AppException>(() => _ops.CancelTransactionAsync(canceller, id, new CancelTransactionCommand("oops"), default));
        await Assert.ThrowsAsync<AppException>(() => _ops.CancelTransactionAsync(canceller, id, null, default));
        _store.StoredTransaction = $"{{\"id\":\"{id}\",\"branchId\":\"{Kumasi}\"}}";
        await Assert.ThrowsAsync<AppException>(() => _ops.CancelTransactionAsync(canceller, id, new CancelTransactionCommand("Wrong customer"), default));
        _store.StoredTransaction = $"{{\"id\":\"{id}\",\"branchId\":\"{Tarkwa}\"}}";
        await _ops.CancelTransactionAsync(canceller, id, new CancelTransactionCommand("  Wrong customer  "), default);
        Assert.Contains("\"reason\":\"Wrong customer\"", _store.LastCancel);
        Assert.Contains(id.ToString(), _store.LastCancel);
    }

    [Fact]
    public async Task A_purchase_is_planned_and_handed_to_the_store()
    {
        var id = Guid.NewGuid();
        var result = await _ops.CreateTransactionAsync(Teller(), Purchase(id, Tarkwa), id.ToString(), default);
        Assert.False(result.Replayed);
        Assert.Contains("\"calculatedAmount\":", _store.LastPayload);
        Assert.Contains("\"method\":\"cash\"", _store.LastPayload);
    }

    [Fact]
    public async Task A_purchase_carries_its_town_and_a_new_town_needs_a_sensible_name()
    {
        var id = Guid.NewGuid();
        await _ops.CreateTransactionAsync(Teller(), Purchase(id, Tarkwa) with { OriginTown = new TownRef(null, "  Obuasi ") }, id.ToString(), default);
        Assert.Contains("\"originTown\":{\"id\":null,\"name\":\"Obuasi\"}", _store.LastPayload);
        await Assert.ThrowsAsync<AppException>(() => _ops.CreateTownAsync(Teller(), new TownRef(null, "x"), default));
        await _ops.CreateTownAsync(Teller(), new TownRef(null, " Dunkwa "), default);
        Assert.Contains("\"name\":\"Dunkwa\"", _store.LastTown);
    }

    [Fact]
    public async Task Expectations_are_read_with_the_same_right_as_transactions()
    {
        Assert.Equal("{}", await _ops.ExpectationsAsync(Teller(), Guid.NewGuid(), null, default));
    }

    [Fact]
    public async Task Changing_notes_must_balance_use_different_notes_and_stay_in_the_callers_branch()
    {
        ExchangeCommand Ex(Dictionary<string, int>? gave, Dictionary<string, int>? took, Guid? branch = null) =>
            new(Guid.NewGuid(), Guid.Parse("00000000-0000-0000-0000-0000000000d1"), branch ?? Tarkwa, null, gave, took, null, DateTimeOffset.UtcNow);
        var day = Guid.Parse("00000000-0000-0000-0000-0000000000d1");
        var ok = Ex(new() { ["200"] = 1 }, new() { ["100"] = 2 });
        await _ops.RecordExchangeAsync(Swapper(), day, ok, ok.Id.ToString(), default);
        var unequal = Ex(new() { ["200"] = 1 }, new() { ["100"] = 1 });
        await Assert.ThrowsAsync<AppException>(() => _ops.RecordExchangeAsync(Swapper(), day, unequal, unequal.Id.ToString(), default));
        var same = Ex(new() { ["100"] = 2 }, new() { ["100"] = 1, ["50"] = 2 });
        await Assert.ThrowsAsync<AppException>(() => _ops.RecordExchangeAsync(Swapper(), day, same, same.Id.ToString(), default));
        var empty = Ex(new() { ["200"] = 1 }, null);
        await Assert.ThrowsAsync<AppException>(() => _ops.RecordExchangeAsync(Swapper(), day, empty, empty.Id.ToString(), default));
        var other = Ex(new() { ["200"] = 1 }, new() { ["100"] = 2 }, Guid.NewGuid());
        await Assert.ThrowsAsync<AppException>(() => _ops.RecordExchangeAsync(Swapper(), day, other, other.Id.ToString(), default));
        await Assert.ThrowsAsync<AppException>(() => _ops.RecordExchangeAsync(Swapper(), day, ok, Guid.NewGuid().ToString(), default));
    
        // Without the permission a branch cannot swap its own notes, but the counter can still change a customer's notes for a purchase.
        await Assert.ThrowsAsync<AppException>(() => _ops.RecordExchangeAsync(Teller(), day, ok, ok.Id.ToString(), default));
        var forPurchase = new ExchangeCommand(Guid.NewGuid(), day, Tarkwa, Guid.NewGuid(), new() { ["200"] = 1 }, new() { ["100"] = 2 }, null, DateTimeOffset.UtcNow);
        await _ops.RecordExchangeAsync(Teller(), day, forPurchase, forPurchase.Id.ToString(), default);
    }

    [Fact]
    public async Task Paying_needs_notes_a_purchase_in_the_callers_branch_and_sends_only_the_notes()
    {
        var id = Guid.NewGuid();
        _store.StoredTransaction = $"{{\"id\":\"{id}\",\"branchId\":\"{Tarkwa}\"}}";
        await _ops.PayTransactionAsync(Teller(), id, new(new() { ["100"] = 10 }, null, "1000"), default);
        Assert.Contains("\"lines\":{\"100\":10}", _store.LastPay);
        Assert.Contains("\"checkAmount\":1000", _store.LastPay);
        await Assert.ThrowsAsync<AppException>(() => _ops.PayTransactionAsync(Teller(), id, new(null, null, null), default));
        await Assert.ThrowsAsync<AppException>(() => _ops.PayTransactionAsync(Teller(), id, new(new() { ["100"] = 1 }, null, "abc"), default));
        _store.StoredTransaction = $"{{\"id\":\"{id}\",\"branchId\":\"{Kumasi}\"}}";
        await Assert.ThrowsAsync<AppException>(() => _ops.PayTransactionAsync(Teller(), id, new(new() { ["100"] = 10 }, null, null), default));
    }

    [Fact]
    public async Task Everyone_reads_the_settings_but_only_those_allowed_change_them()
    {
        Assert.Equal("{}", await _ops.GetSettingsAsync(Teller(), default));
        var change = new System.Text.Json.Nodes.JsonObject { ["payout.twoStep"] = true };
        await Assert.ThrowsAsync<AppException>(() => _ops.SetSettingsAsync(Teller(), change, default));
        var director = new Ctx([Permissions.SettingsManage], [Tarkwa]);
        await _ops.SetSettingsAsync(director, change, default);
        Assert.Contains("payout.twoStep", _store.LastSettings);
    }

    private static TransactionSearch Search(Guid? branch = null, string? sort = null, string? from = null, string? q = null, int? limit = null) =>
        new(branch, null, q, from, null, null, null, null, null, sort, limit, null);

    [Fact]
    public async Task Searching_purchases_sends_only_the_callers_branches_and_clean_filters()
    {
        await _ops.SearchTransactionsAsync(Teller(), Search(Tarkwa, "amount_desc", "2026-10-01", "  kofi  ", 500), default);
        Assert.Contains($"\"scope\":[\"{Tarkwa}\"]", _store.LastSearch);
        Assert.Contains("\"q\":\"kofi\"", _store.LastSearch);
        Assert.Contains("\"limit\":100", _store.LastSearch);   // clamped
        Assert.Contains("\"sort\":\"amount_desc\"", _store.LastSearch);
    }

    [Fact]
    public async Task Searching_purchases_refuses_other_branches_bad_dates_and_unknown_sorts()
    {
        await Assert.ThrowsAsync<AppException>(() => _ops.SearchTransactionsAsync(Teller(), Search(Kumasi), default));
        await Assert.ThrowsAsync<AppException>(() => _ops.SearchTransactionsAsync(new Ctx([], [Tarkwa]), Search(Tarkwa), default));
        await Assert.ThrowsAsync<AppException>(() => _ops.SearchTransactionsAsync(Teller(), Search(from: "29/10/2026"), default));
        await Assert.ThrowsAsync<AppException>(() => _ops.SearchTransactionsAsync(Teller(), Search(sort: "sideways"), default));
    }

    [Fact]
    public async Task The_dashboard_uses_only_the_callers_branches_and_hides_staff_comparisons_from_tellers()
    {
        var json = await _ops.DashboardAsync(Teller(), null, 500, default);
        Assert.Contains($"\"scope\":[\"{Tarkwa}\"]", _store.LastDashboard);
        Assert.Contains("\"days\":60", _store.LastDashboard);   // clamped
        Assert.DoesNotContain("tellers", json);
        Assert.DoesNotContain("cashDifferences", json);
        Assert.Contains("series", json);
        await Assert.ThrowsAsync<AppException>(() => _ops.DashboardAsync(Teller(), Kumasi, null, default));
        await Assert.ThrowsAsync<AppException>(() => _ops.DashboardAsync(new Ctx([], [Tarkwa]), null, null, default));
    }

    [Fact]
    public async Task The_idempotency_key_must_be_the_requests_own_id()
    {
        var id = Guid.NewGuid();
        var ex = await Assert.ThrowsAsync<AppException>(() => _ops.CreateTransactionAsync(Teller(), Purchase(id, Tarkwa), Guid.NewGuid().ToString(), default));
        Assert.Equal(422, ex.Status);
        await _ops.CreateTransactionAsync(Teller(), Purchase(id, Tarkwa), null, default);   // the header is optional
    }

    [Fact]
    public async Task Someone_cannot_work_in_a_branch_they_are_not_assigned_to()
    {
        var id = Guid.NewGuid();
        var ex = await Assert.ThrowsAsync<AppException>(() => _ops.CreateTransactionAsync(Teller(), Purchase(id, Kumasi), null, default));
        Assert.Equal("BRANCH_NOT_ASSIGNED", ex.Code);
        Assert.Equal(403, ex.Status);
    }

    [Fact]
    public async Task Permissions_are_checked_before_anything_else()
    {
        var nobody = new Ctx([], [Tarkwa]);
        await Assert.ThrowsAsync<AppException>(() => _ops.ListTransactionsAsync(nobody, Tarkwa, 10, default));
        await Assert.ThrowsAsync<AppException>(() => _ops.SetBasePriceAsync(Teller(), new BasePriceCommand("11458", null), default));
        await _ops.SetBasePriceAsync(Manager(), new BasePriceCommand("11458", null), default);
        Assert.Equal(11458m, _store.LastBasePrice);
        await Assert.ThrowsAsync<AppException>(() => _ops.SetMarginAsync(Manager(), Tarkwa, new MarginCommand("190", true), default));   // approving needs prices:approve
        await _ops.SetMarginAsync(Manager(), Tarkwa, new MarginCommand("190", false), default);
    }

    [Fact]
    public async Task A_record_from_another_branch_looks_like_it_does_not_exist()
    {
        _store.StoredTransaction = $"{{\"id\":\"{Guid.NewGuid()}\",\"branchId\":\"{Kumasi}\"}}";
        var ex = await Assert.ThrowsAsync<AppException>(() => _ops.GetTransactionAsync(Teller(), Guid.NewGuid(), default));
        Assert.Equal(404, ex.Status);
        Assert.Contains("branchId", await _ops.GetTransactionAsync(Manager(), Guid.NewGuid(), default));
    }

    [Fact]
    public async Task A_missing_price_is_a_404_with_its_own_code()
    {
        var ex = await Assert.ThrowsAsync<AppException>(() => _ops.CurrentPriceAsync(Teller(), Tarkwa, default));
        Assert.Equal("PRICE_NOT_SET", ex.Code);
    }

    [Fact]
    public async Task Confirming_mobile_money_needs_its_own_permission()
    {
        await Assert.ThrowsAsync<AppException>(() => _ops.ResolvePaymentAsync(Teller(), Guid.NewGuid(), true, null, default));
        await _ops.ResolvePaymentAsync(Manager(), Guid.NewGuid(), true, null, default);
    }

    [Fact]
    public async Task Opening_a_day_checks_the_date_and_the_notes()
    {
        var id = Guid.NewGuid();
        var bad = new OpenDayCommand(id, Tarkwa, "23/10/2026", new() { ["100"] = 1 }, "counted", DateTimeOffset.UtcNow, null);
        Assert.Contains("businessDate", (await Assert.ThrowsAsync<AppException>(() => _ops.OpenDayAsync(Teller(), bad, null, default))).FieldErrors!.Keys);
        var worse = bad with { BusinessDate = "2026-10-23", Lines = new() { ["3"] = 1 } };
        Assert.Equal("BAD_DENOMINATION", (await Assert.ThrowsAsync<AppException>(() => _ops.OpenDayAsync(Teller(), worse, null, default))).Code);
        await _ops.OpenDayAsync(Teller(), bad with { BusinessDate = "2026-10-23" }, id.ToString(), default);
    }

    [Fact]
    public async Task Pending_mobile_money_lists_follow_the_role()
    {
        await Assert.ThrowsAsync<AppException>(() => _ops.PendingPaymentsAsync(Teller(), Tarkwa, "sending", default));   // teller cannot confirm
        await _ops.PendingPaymentsAsync(Teller(), Tarkwa, "receiving", default);
        await _ops.PendingPaymentsAsync(Manager(), Tarkwa, null, default);
        Assert.Equal(422, (await Assert.ThrowsAsync<AppException>(() => _ops.PendingPaymentsAsync(Manager(), Tarkwa, "both", default))).Status);
        Assert.Equal("BRANCH_NOT_ASSIGNED", (await Assert.ThrowsAsync<AppException>(() => _ops.PendingPaymentsAsync(Teller(), Kumasi, "receiving", default))).Code);
    }

    // ---- closing ----
    private static readonly Guid DayId = Guid.Parse("44444444-4444-4444-8444-444444444444");

    private static CloseDayCommand Close(Guid id, Action<Dictionary<string, string>>? why = null, bool accepted = true, string version = "v3", string? goodsTop = "7.77")
    {
        var explanations = new Dictionary<string, string>();
        why?.Invoke(explanations);
        return new CloseDayCommand(id, DayId, Tarkwa,
            new DeclaredFigures(new() { ["100"] = 85 }, goodsTop, "0.41", "1000", "500", "0", "24.5"), explanations,
            new ConfirmationInput(accepted, version), DateTimeOffset.UtcNow);
    }

    private void DayIsInTarkwa() => _store.StoredDay = $"{{\"id\":\"{DayId}\",\"branchId\":\"{Tarkwa}\"}}";

    [Fact]
    public async Task Closing_sends_every_figure_and_the_exact_wording_the_teller_accepted()
    {
        var id = Guid.NewGuid();
        await _ops.CloseDayAsync(Teller(), DayId, Close(id, w => w["goods_top"] = "scale reads lower"), id.ToString(), default);
        Assert.Contains("\"goodsTop\":7.77", _store.LastPayload);
        Assert.Contains("\"custodyTop\":24.5", _store.LastPayload);
        Assert.Contains("\"version\":\"v3\"", _store.LastPayload);
        Assert.Contains("unrefined gold held as security", _store.LastPayload);
        Assert.Contains("scale reads lower", _store.LastPayload);
    }

    [Fact]
    public async Task Closing_is_refused_without_the_tick_and_with_outdated_wording()
    {
        var ex = await Assert.ThrowsAsync<AppException>(() => _ops.CloseDayAsync(Teller(), DayId, Close(Guid.NewGuid(), accepted: false), null, default));
        Assert.Equal("CONFIRMATION_REQUIRED", ex.Code);
        ex = await Assert.ThrowsAsync<AppException>(() => _ops.CloseDayAsync(Teller(), DayId, Close(Guid.NewGuid(), version: "v2"), null, default));
        Assert.Equal("CONFIRMATION_OUTDATED", ex.Code);
        Assert.Equal(409, ex.Status);
    }

    [Fact]
    public async Task Closing_figures_must_be_real_numbers()
    {
        var ex = await Assert.ThrowsAsync<AppException>(() => _ops.CloseDayAsync(Teller(), DayId, Close(Guid.NewGuid(), goodsTop: "-1"), null, default));
        Assert.Contains("declared.goodsTop", ex.FieldErrors!.Keys);
        ex = await Assert.ThrowsAsync<AppException>(() => _ops.CloseDayAsync(Teller(), DayId, Close(Guid.NewGuid(), goodsTop: "7.77777"), null, default));
        Assert.Contains("declared.goodsTop", ex.FieldErrors!.Keys);
        ex = await Assert.ThrowsAsync<AppException>(() => _ops.CloseDayAsync(Teller(), DayId, Close(Guid.NewGuid(), w => w["nonsense"] = "x"), null, default));
        Assert.Equal(422, ex.Status);
    }

    [Fact]
    public async Task Closing_needs_days_manage_and_the_right_branch()
    {
        await Assert.ThrowsAsync<AppException>(() => _ops.CloseDayAsync(new Ctx([], [Tarkwa]), DayId, Close(Guid.NewGuid()), null, default));
        var other = Close(Guid.NewGuid()) with { BranchId = Kumasi };
        Assert.Equal("BRANCH_NOT_ASSIGNED", (await Assert.ThrowsAsync<AppException>(() => _ops.CloseDayAsync(Teller(), DayId, other, null, default))).Code);
    }

    [Fact]
    public async Task The_preview_carries_the_current_wording_and_hides_other_branches_days()
    {
        await Assert.ThrowsAsync<AppException>(() => _ops.ClosingPreviewAsync(Teller(), DayId, default));   // no such day for them
        DayIsInTarkwa();
        var preview = await _ops.ClosingPreviewAsync(Teller(), DayId, default);
        Assert.Contains("\"version\":\"v3\"", preview);
        Assert.Contains("physically verified", preview);
    }

    [Fact]
    public async Task A_days_own_activity_needs_days_read_and_a_day_in_the_callers_branches()
    {
        await Assert.ThrowsAsync<AppException>(() => _ops.DayActivityAsync(Teller(), DayId, default));   // no such day for them
        DayIsInTarkwa();
        Assert.Equal("{}", await _ops.DayActivityAsync(Teller(), DayId, default));
        await Assert.ThrowsAsync<AppException>(() => _ops.DayActivityAsync(new Ctx([], [Tarkwa]), DayId, default));
        await Assert.ThrowsAsync<AppException>(() => _ops.DayActivityAsync(new Ctx([Permissions.DaysRead], [Kumasi]), DayId, default));
    }

    [Fact]
    public async Task Only_a_signoff_holder_in_the_branch_can_sign_and_only_with_a_real_decision()
    {
        DayIsInTarkwa();
        await Assert.ThrowsAsync<AppException>(() => _ops.SignoffDayAsync(Teller(), DayId, new SignoffCommand("approved", null), default));
        var director = new Ctx([Permissions.DaysSignoff], [Tarkwa]);
        await Assert.ThrowsAsync<AppException>(() => _ops.SignoffDayAsync(director, DayId, new SignoffCommand("maybe", null), default));
        await _ops.SignoffDayAsync(director, DayId, new SignoffCommand("approved", "checked"), default);
        Assert.Equal("approved", _store.LastSignoff);
        var elsewhere = new Ctx([Permissions.DaysSignoff], [Kumasi]);
        Assert.Equal(404, (await Assert.ThrowsAsync<AppException>(() => _ops.SignoffDayAsync(elsewhere, DayId, new SignoffCommand("approved", null), default))).Status);
    }

    [Fact]
    public async Task History_filters_are_checked()
    {
        var ex = await Assert.ThrowsAsync<AppException>(() => _ops.ListDaysAsync(Teller(), Tarkwa, "yesterday", null, "pending", null, default));
        Assert.Contains("from", ex.FieldErrors!.Keys);
        await Assert.ThrowsAsync<AppException>(() => _ops.ListDaysAsync(Teller(), Tarkwa, null, null, "whatever", null, default));
        await _ops.ListDaysAsync(Teller(), Tarkwa, "2026-10-01", "2026-10-31", "pending", 20, default);
    }

    // ---- fakes ----
    private sealed class FixedClock : IClock
    {
        public DateTimeOffset UtcNow => new(2026, 10, 23, 9, 0, 0, TimeSpan.Zero);
    }

    private sealed class Ctx(IEnumerable<string> permissions, IEnumerable<Guid> branches) : ICurrentContext
    {
        public Guid TenantId => Guid.Parse("33333333-3333-4333-8333-333333333333");
        public Guid UserId => Guid.Parse("aaaaaaaa-0000-4000-8000-000000000001");
        public IReadOnlySet<Guid> BranchIds { get; } = branches.ToHashSet();
        public IReadOnlySet<string> Permissions { get; } = permissions.ToHashSet();
        public bool Has(string permission) => Permissions.Contains(permission);
    }

    private sealed class FakeStore : IOperationsStore
    {
        public string? LastPayload;
        public decimal LastBasePrice;
        public string? StoredTransaction;

        public Task<CalcConfig> GetCalcConfigAsync(ICurrentContext me, string v, CancellationToken ct) => Task.FromResult(CalcConfig.ExcelV1);
        public Task<string?> GetCurrentPriceAsync(ICurrentContext me, Guid b, CancellationToken ct) => Task.FromResult<string?>(null);
        public int LastHistoryDays;
        public Task<string> PriceHistoryAsync(ICurrentContext me, Guid b, int days, CancellationToken ct) { LastHistoryDays = days; return Task.FromResult("{}"); }
        public Task SetBasePriceAsync(ICurrentContext me, decimal p, DateTimeOffset? at, CancellationToken ct) { LastBasePrice = p; return Task.CompletedTask; }
        public Task<string> SetMarginAsync(ICurrentContext me, Guid b, decimal m, bool a, CancellationToken ct) => Task.FromResult("{}");
        public Task<string> ApproveMarginAsync(ICurrentContext me, Guid b, CancellationToken ct) => Task.FromResult("{}");
        public Task<string> DayStateAsync(ICurrentContext me, Guid b, CancellationToken ct) => Task.FromResult("{}");
        public Task<DbResult> OpenDayAsync(ICurrentContext me, string p, CancellationToken ct) { LastPayload = p; return Task.FromResult(new DbResult(false, "{}")); }
        public Task<DbResult> RecordMovementAsync(ICurrentContext me, string p, CancellationToken ct) => Task.FromResult(new DbResult(false, "{}"));
        public Task<string> ListExchangesAsync(ICurrentContext me, Guid branchId, int limit, CancellationToken ct) => Task.FromResult("[]");
        public Task<DbResult> RecordExchangeAsync(ICurrentContext me, string p, CancellationToken ct) => Task.FromResult(new DbResult(false, "{}"));
        public string? LastPay;
        public Task<DbResult> PayTransactionAsync(ICurrentContext me, string p, CancellationToken ct) { LastPay = p; return Task.FromResult(new DbResult(false, "{}")); }
        public Task<string> ToPayAsync(ICurrentContext me, Guid branchId, string? search, CancellationToken ct) => Task.FromResult("[]");
        public string? LastSettings;
        public Task<string> GetSettingsAsync(ICurrentContext me, CancellationToken ct) => Task.FromResult("{}");
        public Task<string> SetSettingsAsync(ICurrentContext me, string s, CancellationToken ct) { LastSettings = s; return Task.FromResult(s); }
        public string? StoredDay;
        public string? LastSignoff;
        public Task<string> DayActivityAsync(ICurrentContext me, Guid id, CancellationToken ct) => Task.FromResult("{}");
        public Task<string?> GetDayAsync(ICurrentContext me, Guid id, CancellationToken ct) => Task.FromResult(StoredDay);
        public Task<string> ListDaysAsync(ICurrentContext me, Guid b, DateOnly? f, DateOnly? t, string? s, int l, CancellationToken ct) => Task.FromResult("[]");
        public Task<string> ClosingPreviewAsync(ICurrentContext me, Guid id, CancellationToken ct) => Task.FromResult("{\"expected\":{}}");
        public Task<DbResult> CloseDayAsync(ICurrentContext me, string p, CancellationToken ct) { LastPayload = p; return Task.FromResult(new DbResult(false, "{}")); }
        public Task<string> SignoffDayAsync(ICurrentContext me, Guid id, string decision, string? note, CancellationToken ct) { LastSignoff = decision; return Task.FromResult("{}"); }
        public Task<string?> GetCollateralAsync(ICurrentContext me, Guid id, CancellationToken ct) => Task.FromResult<string?>(null);
        public Task<DbResult> PostTransactionAsync(ICurrentContext me, string p, CancellationToken ct) { LastPayload = p; return Task.FromResult(new DbResult(false, "{}")); }
        public Task<string> ListTransactionsAsync(ICurrentContext me, Guid b, int l, CancellationToken ct) => Task.FromResult("[]");
        public string? LastSearch;
        public Task<string> SearchTransactionsAsync(ICurrentContext me, string filterJson, CancellationToken ct) { LastSearch = filterJson; return Task.FromResult("{\"items\":[],\"total\":0,\"sumPayable\":\"0\"}"); }
        public string? LastDashboard;
        public Task<string> DashboardAsync(ICurrentContext me, string filterJson, CancellationToken ct) { LastDashboard = filterJson; return Task.FromResult("{\"today\":{},\"tellers\":[],\"topCustomers\":[],\"cashDifferences\":{},\"series\":[]}"); }
        public Task<string?> GetTransactionAsync(ICurrentContext me, Guid id, CancellationToken ct) => Task.FromResult(StoredTransaction);
        public string? LastCancel;
        public Task<string> CancelTransactionAsync(ICurrentContext me, string json, CancellationToken ct) { LastCancel = json; return Task.FromResult("{}"); }
        public Task<string> ResolvePaymentAsync(ICurrentContext me, Guid id, string o, string? r, CancellationToken ct) => Task.FromResult("{}");
        public Task<string> PendingPaymentsAsync(ICurrentContext me, Guid b, string role, CancellationToken ct) => Task.FromResult("[]");
        public Task<string> ExpectationsAsync(ICurrentContext me, Guid? t, Guid? c, CancellationToken ct) => Task.FromResult("{}");
        public Task<string> ListTownsAsync(ICurrentContext me, string? q, CancellationToken ct) => Task.FromResult("[]");
        public Task<string> CreateTownAsync(ICurrentContext me, string p, CancellationToken ct) { LastTown = p; return Task.FromResult("{}"); }
        public string? LastTown;
        public Task<string> SearchCustomersAsync(ICurrentContext me, string? q, Guid? branchId, int limit, CancellationToken ct) => Task.FromResult("[]");
        public Task<DbResult> IssueLoanAsync(ICurrentContext me, string p, CancellationToken ct) => Task.FromResult(new DbResult(false, "{}"));
        public Task<DbResult> RepayDebtAsync(ICurrentContext me, string p, CancellationToken ct) => Task.FromResult(new DbResult(false, "{}"));
        public Task<string> ListDebtsAsync(ICurrentContext me, Guid b, string? d, bool o, Guid? c, CancellationToken ct) => Task.FromResult("[]");
        public Task<string?> GetDebtAsync(ICurrentContext me, Guid id, CancellationToken ct) => Task.FromResult<string?>(null);
        public Task<string> ListCollateralAsync(ICurrentContext me, Guid b, string? s, CancellationToken ct) => Task.FromResult("[]");
        public Task<string> ReturnCollateralAsync(ICurrentContext me, Guid id, string? n, CancellationToken ct) => Task.FromResult("{}");
    }
}