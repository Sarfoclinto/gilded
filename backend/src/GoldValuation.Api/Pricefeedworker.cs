using GoldValuation.Application.PriceFeed;

namespace GoldValuation.Api;

/// <summary>
/// Wakes every 30 seconds and, for each company with the automatic price switched on, asks whether it is time to look (inside a check window,
/// no price captured yet in it, and the chosen interval has passed). Two API instances looking at the same moment is harmless: a price already
/// recorded for the same publication time is ignored.
/// </summary>
public sealed class PriceFeedWorker(IServiceScopeFactory scopes, ILogger<PriceFeedWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        // Let the API finish starting before the first look.
        try { await Task.Delay(TimeSpan.FromSeconds(10), stop); } catch (OperationCanceledException) { return; }
        while (!stop.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var store = scope.ServiceProvider.GetRequiredService<IPriceFeedStore>();
                var service = scope.ServiceProvider.GetRequiredService<PriceFeedService>();
                foreach (var tenant in await store.EnabledCompaniesAsync(stop))
                {
                    try { await service.RunIfDueAsync(tenant, stop); }
                    catch (OperationCanceledException) when (stop.IsCancellationRequested) { return; }
                    catch (Exception ex) { log.LogWarning(ex, "Automatic price: the look for company {Tenant} failed", tenant); }
                }
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { return; }
            catch (Exception ex) { log.LogWarning(ex, "Automatic price: could not list the companies"); }
            try { await Task.Delay(TimeSpan.FromSeconds(30), stop); } catch (OperationCanceledException) { return; }
        }
    }
}
