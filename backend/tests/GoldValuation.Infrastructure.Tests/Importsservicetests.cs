using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;
using GoldValuation.Application.Imports;
using GoldValuation.Application.Operations;
using GoldValuation.Domain.Calculation;
using Xunit;

namespace GoldValuation.Infrastructure.Tests;

public class ImportsServiceTests
{
    private static readonly Guid Tarkwa = Guid.Parse("22222222-2222-4222-8222-222222222222");
    private static readonly Guid Kumasi = Guid.Parse("44444444-4444-4444-8444-444444444444");
    private readonly FakeStore _store = new();
    private readonly ImportsService _svc;

    public ImportsServiceTests() => _svc = new ImportsService(_store);

    private static Ctx Director() => new([Permissions.ImportsManage], [Tarkwa]);
    private static Ctx Manager() => new([Permissions.ReportsRead], [Tarkwa]);

    private static JsonObject Batch(string rowJson) =>
        JsonNode.Parse($$"""{"batchId":"{{Guid.NewGuid()}}","label":"March","rows":[{{rowJson}}]}""")!.AsObject();

    private static string Row(string extra = "", Guid? branch = null) =>
        $$"""{"key":"2","branchId":"{{branch ?? Tarkwa}}","capturedAt":"2026-03-02T10:00:00Z","customerName":"Kofi","customerPhone":"024","items":[{"top":"7.77","down":"0.41","price":"11650"}]{{extra}}}""";

    [Fact]
    public async Task Only_a_person_with_the_import_permission_may_import_or_undo()
    {
        await Assert.ThrowsAsync<AppException>(() => _svc.ImportHistoryAsync(Manager(), Batch(Row()), default));
        await Assert.ThrowsAsync<AppException>(() => _svc.ImportCustomersAsync(Manager(), JsonNode.Parse("""{"rows":[{"name":"a","phone":"1"}]}""")!.AsObject(), default));
        await Assert.ThrowsAsync<AppException>(() => _svc.ListBatchesAsync(Manager(), default));
        await Assert.ThrowsAsync<AppException>(() => _svc.UndoBatchAsync(Manager(), Guid.NewGuid(), "wrong sheet", default));
    }

    [Fact]
    public async Task Amounts_are_recalculated_on_the_server_and_a_different_sheet_figure_is_flagged()
    {
        await _svc.ImportHistoryAsync(Director(), Batch(Row(""","sheetAmount":"1" """)), default);
        var sent = JsonNode.Parse(_store.LastPayload!)!.AsObject();
        var row = sent["rows"]![0]!;
        var calculated = (decimal)row["calculatedAmount"]!;
        Assert.True(calculated > 1000);                                   // computed here, not taken from the sheet
        Assert.Equal(decimal.Truncate(calculated), (decimal)row["payable"]!);
        Assert.Equal("CALC_MISMATCH", (string?)row["flags"]![0]);
        Assert.Equal("ExcelV1", (string?)row["formulaVersion"]);
        Assert.NotNull(row["items"]![0]!["amount"]);
    }

    [Fact]
    public async Task The_amount_paid_from_the_sheet_is_kept_as_the_payable()
    {
        await _svc.ImportHistoryAsync(Director(), Batch(Row(""","amountPaid":"5000" """)), default);
        Assert.Equal(5000m, (decimal)JsonNode.Parse(_store.LastPayload!)!["rows"]![0]!["payable"]!);
    }

    [Fact]
    public async Task Bad_rows_are_refused_with_their_row_number_and_nothing_is_sent()
    {
        var ex = await Assert.ThrowsAsync<AppException>(() => _svc.ImportHistoryAsync(Director(),
            Batch(Row().Replace("\"7.77\"", "\"abc\"")), default));
        Assert.Contains(ex.FieldErrors!.Keys, k => k.Contains("row 2"));
        await Assert.ThrowsAsync<AppException>(() => _svc.ImportHistoryAsync(Director(), Batch(Row().Replace("2026-03-02", "2999-03-02")), default));
        await Assert.ThrowsAsync<AppException>(() => _svc.ImportHistoryAsync(Director(), Batch(Row("", Kumasi)), default));   // not their branch
        await Assert.ThrowsAsync<AppException>(() => _svc.ImportHistoryAsync(Director(), Batch(Row().Replace("\"Kofi\"", "\"\"")), default));
        Assert.Null(_store.LastPayload);
    }

    [Fact]
    public async Task Customers_need_a_name_and_a_phone_and_an_undo_needs_a_reason()
    {
        await Assert.ThrowsAsync<AppException>(() => _svc.ImportCustomersAsync(Director(), JsonNode.Parse("""{"rows":[{"name":"No phone"}]}""")!.AsObject(), default));
        await _svc.ImportCustomersAsync(Director(), JsonNode.Parse("""{"rows":[{"name":" Yaw ","phone":"0242"}]}""")!.AsObject(), default);
        Assert.Equal("Yaw", (string?)JsonNode.Parse(_store.LastPayload!)!["rows"]![0]!["name"]);
        await Assert.ThrowsAsync<AppException>(() => _svc.UndoBatchAsync(Director(), Guid.NewGuid(), " x ", default));
        await _svc.UndoBatchAsync(Director(), Guid.NewGuid(), "Wrong sheet used", default);
    }

    private sealed class Ctx(IEnumerable<string> permissions, IEnumerable<Guid> branches) : ICurrentContext
    {
        private readonly HashSet<string> _permissions = permissions.ToHashSet();
        public Guid TenantId => Guid.Parse("33333333-3333-4333-8333-333333333333");
        public Guid UserId => Guid.Parse("aaaaaaaa-0000-4000-8000-000000000001");
        public IReadOnlySet<Guid> BranchIds { get; } = branches.ToHashSet();
        public bool Has(string permission) => _permissions.Contains(permission);
    }

    private sealed class FakeStore : IImportsStore
    {
        public string? LastPayload;
        public Task<CalcConfig> GetCalcConfigAsync(ICurrentContext me, string formulaVersion, CancellationToken ct) => Task.FromResult(CalcConfig.ExcelV1);
        public Task<string> ImportHistoryAsync(ICurrentContext me, string payloadJson, CancellationToken ct) { LastPayload = payloadJson; return Task.FromResult("{}"); }
        public Task<string> ImportCustomersAsync(ICurrentContext me, string payloadJson, CancellationToken ct) { LastPayload = payloadJson; return Task.FromResult("{}"); }
        public Task<string> ListBatchesAsync(ICurrentContext me, CancellationToken ct) => Task.FromResult("[]");
        public Task<string> UndoBatchAsync(ICurrentContext me, Guid batchId, string reason, CancellationToken ct) => Task.FromResult("{}");
    }

}
