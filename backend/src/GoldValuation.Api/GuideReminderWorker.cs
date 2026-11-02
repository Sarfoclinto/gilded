using GoldValuation.Application.Guide;

namespace GoldValuation.Api;

/// <summary>
/// Wakes every minute and, for each company with Guide reminders on, asks the database whether one is due (it is, once a day, at the chosen
/// time in the company's own timezone). Two API instances waking together is harmless: the database remembers the day it last sent.
/// </summary>
public sealed class GuideReminderWorker(IServiceScopeFactory scopes, ILogger<GuideReminderWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        try { await Task.Delay(TimeSpan.FromSeconds(20), stop); } catch (OperationCanceledException) { return; }
        while (!stop.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var service = scope.ServiceProvider.GetRequiredService<GuideService>();
                foreach (var tenant in await service.ReminderCompaniesAsync(stop))
                {
                    try
                    {
                        var n = await service.RunRemindersAsync(tenant, stop);
                        if (n > 0) log.LogInformation("Guide reminder sent to {Count} people in company {Tenant}", n, tenant);
                    }
                    catch (OperationCanceledException) when (stop.IsCancellationRequested) { return; }
                    catch (Exception ex) { log.LogWarning(ex, "Guide reminder for company {Tenant} failed", tenant); }
                }
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { return; }
            catch (Exception ex) { log.LogWarning(ex, "Guide reminders: could not list the companies"); }
            try { await Task.Delay(TimeSpan.FromMinutes(1), stop); } catch (OperationCanceledException) { return; }
        }
    }
}