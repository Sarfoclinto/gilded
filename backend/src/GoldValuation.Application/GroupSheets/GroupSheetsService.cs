using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;

namespace GoldValuation.Application.GroupSheets;

/// <summary>Persistence for Group Sheets (migration 0072). Every call runs as the signed-in person; the database decides what they may see and do.</summary>
public interface IGroupSheetsStore
{
    /// <summary>Runs one action of <c>gold.group_sheets(action, payload)</c>; null when the action returned nothing.</summary>
    Task<string?> CallAsync(ICurrentContext me, string action, string payloadJson, CancellationToken ct);
}

/// <summary>
/// Group Sheets: private running records (kitchen fees, mercury sales…) for a chosen group. Only the group's members see them: no
/// company role or permission opens a group, and that rule lives in the database (row-level security), not here. This service only
/// checks the request's shape and size and passes it to the one database entry point.
/// </summary>
public sealed class GroupSheetsService(IGroupSheetsStore store)
{
    public const int MaxPayloadChars = 20_000;

    public static readonly IReadOnlySet<string> Actions = new HashSet<string>
    {
        "home", "group_get", "group_create", "group_rename", "member_set", "member_remove", "member_unexclude", "leave", "rule_set", "rule_remove",
        "name_keeper", "sheet_create", "sheet_update", "sheet_delete", "access_set", "sheet_get", "entry_add", "entry_take_back", "activity",
    };

    public async Task<string> CallAsync(ICurrentContext me, string action, JsonObject? payload, CancellationToken ct)
    {
        if (!Actions.Contains(action)) throw AppException.NotFound("That page");
        var json = (payload ?? new JsonObject()).ToJsonString();
        if (json.Length > MaxPayloadChars) throw AppException.Invalid("The request is too big.");
        return await store.CallAsync(me, action, json, ct) ?? throw AppException.NotFound("That page");
    }
}