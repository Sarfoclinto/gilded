using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Guide;
using GoldValuation.Infrastructure.Operations;
using GoldValuation.Infrastructure.Persistence;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;

namespace GoldValuation.Infrastructure.Guide;

/// <summary>Calls the database functions of migration 0046. The reminder worker's calls name only the company (nobody is signed in).</summary>
public sealed class PostgresGuideStore(NpgsqlDataSource dataSource, ILogger<PostgresGuideStore> log) : IGuideStore
{
    public Task<string> ReaderAsync(ICurrentContext me, CancellationToken ct) => Text(me, "select gold.guide_json()", ct);
    public Task<string> ArticleAsync(ICurrentContext me, Guid id, bool includeDraft, CancellationToken ct) => Text(me, "select gold.guide_article_json($1, $2)", ct, Uuid(id), Bool(includeDraft));
    public Task<string> MarkReadAsync(ICurrentContext me, Guid id, CancellationToken ct) => Text(me, "select gold.guide_mark_read($1)", ct, Uuid(id));
    public Task<string> AdminAsync(ICurrentContext me, CancellationToken ct) => Text(me, "select gold.guide_admin_json()", ct);
    public Task<string> SaveCategoryAsync(ICurrentContext me, string json, CancellationToken ct) => Text(me, "select gold.guide_save_category($1)", ct, Json(json));
    public Task<string> DeleteCategoryAsync(ICurrentContext me, Guid id, CancellationToken ct) => Text(me, "select gold.guide_delete_category($1)", ct, Uuid(id));
    public Task<string> SaveArticleAsync(ICurrentContext me, string json, CancellationToken ct) => Text(me, "select gold.guide_save_article($1)", ct, Json(json));
    public Task<string> PublishAsync(ICurrentContext me, Guid id, string json, CancellationToken ct) => Text(me, "select gold.guide_publish($1, $2)", ct, Uuid(id), Json(json));
    public Task<string> UnpublishAsync(ICurrentContext me, Guid id, CancellationToken ct) => Text(me, "select gold.guide_unpublish($1)", ct, Uuid(id));
    public Task<string> DeleteArticleAsync(ICurrentContext me, Guid id, CancellationToken ct) => Text(me, "select gold.guide_delete_article($1)", ct, Uuid(id));
    public Task<string> ReadersAsync(ICurrentContext me, Guid id, CancellationToken ct) => Text(me, "select gold.guide_readers_json($1)", ct, Uuid(id));
    public Task<string> SaveRemindersAsync(ICurrentContext me, string json, CancellationToken ct) => Text(me, "select gold.set_guide_reminders($1)", ct, Json(json));

    public async Task<IReadOnlyList<Guid>> ReminderCompaniesAsync(CancellationToken ct)
    {
        await using var cmd = dataSource.CreateCommand("select tenant_id from gold.guide_reminder_registry");
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var ids = new List<Guid>();
        while (await reader.ReadAsync(ct)) ids.Add(reader.GetGuid(0));
        return ids;
    }

    public async Task<int> RunRemindersAsync(Guid tenantId, DateTimeOffset now, CancellationToken ct) =>
        await Run<int>(tenantId, null, "select gold.guide_reminder_run($1)", ct, new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.TimestampTz, Value = now.UtcDateTime });

    private async Task<string> Text(ICurrentContext me, string sql, CancellationToken ct, params NpgsqlParameter[] args) =>
        (await Run<string>(me.TenantId, me.UserId, sql, ct, args))!;

    private async Task<T?> Run<T>(Guid tenantId, Guid? userId, string sql, CancellationToken ct, params NpgsqlParameter[] args)
    {
        try
        {
            await using var session = await TenantSession.BeginAsync(dataSource, tenantId, userId, ct);
            await using var cmd = new NpgsqlCommand(sql, session.Connection, session.Transaction);
            foreach (var a in args) cmd.Parameters.Add(a);
            var value = await cmd.ExecuteScalarAsync(ct);
            await session.CommitAsync(ct);
            return value is null or DBNull ? default : (T)value;
        }
        catch (PostgresException ex) when (PostgresOperationsStore.Translate(ex, log) is { } app)
        {
            throw app;
        }
    }

    private static NpgsqlParameter Uuid(Guid id) => new() { NpgsqlDbType = NpgsqlDbType.Uuid, Value = id };
    private static NpgsqlParameter Bool(bool b) => new() { NpgsqlDbType = NpgsqlDbType.Boolean, Value = b };
    private static NpgsqlParameter Json(string json) => new() { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = json };
}