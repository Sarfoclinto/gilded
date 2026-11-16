using GoldValuation.Application.Personal;

namespace GoldValuation.Api;

/// <summary>Once an hour, for each company that has personal pictures: removes the pictures of people who were deactivated longer ago than the company's waiting time (90 days unless changed).</summary>
public sealed class PersonalPicturesWorker(IServiceScopeFactory scopes, ILogger<PersonalPicturesWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        try { await Task.Delay(TimeSpan.FromMinutes(2), stop); } catch (OperationCanceledException) { return; }
        while (!stop.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var service = scope.ServiceProvider.GetRequiredService<PersonalPicturesService>();
                foreach (var tenant in await service.PurgeCompaniesAsync(stop))
                {
                    try
                    {
                        var n = await service.PurgeAsync(tenant, stop);
                        if (n > 0) log.LogInformation("Removed {Count} personal pictures of people who left, company {Tenant}", n, tenant);
                    }
                    catch (OperationCanceledException) when (stop.IsCancellationRequested) { return; }
                    catch (Exception ex) { log.LogWarning(ex, "Personal pictures clean-up for company {Tenant} failed", tenant); }
                }
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { return; }
            catch (Exception ex) { log.LogWarning(ex, "Personal pictures clean-up: could not list the companies"); }
            try { await Task.Delay(TimeSpan.FromHours(1), stop); } catch (OperationCanceledException) { return; }
        }
    }
}