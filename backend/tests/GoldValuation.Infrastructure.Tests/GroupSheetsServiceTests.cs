using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.GroupSheets;
using Xunit;

namespace GoldValuation.Infrastructure.Tests;

public class GroupSheetsServiceTests
{
    private sealed class Ctx : ICurrentContext
    {
        public Guid TenantId { get; } = Guid.NewGuid();
        public Guid UserId { get; } = Guid.NewGuid();
        public IReadOnlySet<Guid> BranchIds { get; } = new HashSet<Guid>();
        public bool Has(string permission) => true;   // permissions never open a group: the database decides
    }

    private sealed class Store : IGroupSheetsStore
    {
        public string? Action; public string? Payload; public string? Answer = "{}";
        public Task<string?> CallAsync(ICurrentContext me, string action, string payloadJson, CancellationToken ct) { Action = action; Payload = payloadJson; return Task.FromResult(Answer); }
    }

    [Fact]
    public async Task Passes_a_known_action_and_its_payload_to_the_database()
    {
        var store = new Store(); var svc = new GroupSheetsService(store);
        await svc.CallAsync(new Ctx(), "entry_add", JsonNode.Parse("""{"sheetId":"s","amount":"50","direction":"in"}""")!.AsObject(), default);
        Assert.Equal("entry_add", store.Action);
        Assert.Equal("50", (string?)JsonNode.Parse(store.Payload!)!["amount"]);
    }

    [Fact]
    public async Task Refuses_unknown_actions_and_huge_requests_before_the_database()
    {
        var store = new Store(); var svc = new GroupSheetsService(store);
        await Assert.ThrowsAsync<AppException>(() => svc.CallAsync(new Ctx(), "drop_everything", null, default));
        await Assert.ThrowsAsync<AppException>(() => svc.CallAsync(new Ctx(), "entry_add", new JsonObject { ["note"] = new string('x', 30_000) }, default));
        Assert.Null(store.Action);
    }

    [Fact]
    public async Task Nothing_back_from_the_database_is_not_found()
    {
        var store = new Store { Answer = null }; var svc = new GroupSheetsService(store);
        var ex = await Assert.ThrowsAsync<AppException>(() => svc.CallAsync(new Ctx(), "sheet_get", new JsonObject(), default));
        Assert.Equal(404, ex.Status);
    }
}