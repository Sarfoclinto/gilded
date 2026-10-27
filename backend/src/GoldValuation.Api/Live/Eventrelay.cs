using System.Threading.Channels;
using GoldValuation.Infrastructure.Live;
using Microsoft.AspNetCore.SignalR;
using Npgsql;

namespace GoldValuation.Api.Live;

/// <summary>
/// Listens to the database channel <c>gold_events</c> and relays each message to the right SignalR groups. Every API instance listens,
/// so it keeps working with several instances behind a load balancer (within one instance; for several, add a SignalR backplane).
/// If the database connection drops it reconnects with a growing pause and tells clients to refresh ("resync"), because events may have been missed.
/// </summary>
public sealed class EventRelay(NpgsqlDataSource dataSource, IHubContext<LiveHub> hub, ILogger<EventRelay> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        var pause = TimeSpan.FromSeconds(1);
        var first = true;
        while (!stop.IsCancellationRequested)
        {
            try
            {
                await using var conn = await dataSource.OpenConnectionAsync(stop);
                var queue = Channel.CreateUnbounded<LiveEvent>();
                conn.Notification += (_, e) => { if (LiveEvent.Parse(e.Payload) is { } ev) queue.Writer.TryWrite(ev); };
                await using (var listen = new NpgsqlCommand($"LISTEN {LiveEvent.Channel}", conn)) await listen.ExecuteNonQueryAsync(stop);
                log.LogInformation("Live updates: listening on {Channel}", LiveEvent.Channel);
                pause = TimeSpan.FromSeconds(1);
                if (!first) await hub.Clients.All.SendAsync("resync", cancellationToken: stop);
                first = false;

                while (!stop.IsCancellationRequested)
                {
                    await conn.WaitAsync(stop);
                    while (queue.Reader.TryRead(out var ev)) await Deliver(ev, stop);
                }
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                log.LogWarning(ex, "Live updates: lost the database connection; retrying in {Pause}", pause);
                try { await Task.Delay(pause, stop); } catch (OperationCanceledException) { return; }
                pause = TimeSpan.FromSeconds(Math.Min(pause.TotalSeconds * 2, 30));
            }
        }
    }

    private async Task Deliver(LiveEvent ev, CancellationToken ct)
    {
        try
        {
            var groups = ev.Groups();
            if (groups.Count == 0) return;
            if (ev.Kind == "notification")
                await hub.Clients.Groups(groups).SendAsync("notification", new { id = ev.NotificationId, kind = ev.NotificationKind, title = ev.Title, link = ev.Link }, ct);
            else
                await hub.Clients.Groups(groups).SendAsync("changed", new { topic = ev.Topic }, ct);
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Live updates: could not deliver an event");
        }
    }
}
