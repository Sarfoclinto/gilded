using GoldValuation.Api;
using GoldValuation.Api.Auth;
using GoldValuation.Api.Endpoints;
using GoldValuation.Api.Live;
using GoldValuation.Infrastructure;
using Npgsql;

// Operator commands (migrate, baseline, seed) run and exit without starting the web server.
if (await Cli.TryRunAsync(args)) return;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddAuth(builder.Configuration);
builder.Services.AddProblemDetails();
builder.Services.AddSignalR();
builder.Services.AddHostedService<EventRelay>();
builder.Services.AddHostedService<PriceFeedWorker>();
builder.Services.AddHostedService<GuideReminderWorker>();

var app = builder.Build();
app.UseMiddleware<ErrorEnvelopeMiddleware>();
app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

// Liveness: the process is up. Readiness: it can reach its database. Load balancers and uptime monitors use these.
app.MapGet("/health/live", () => Results.Ok(new { status = "ok" })).AllowAnonymous();
app.MapGet("/health/ready", async (NpgsqlDataSource db, CancellationToken ct) =>
{
    await using var cmd = db.CreateCommand("select 1");
    await cmd.ExecuteScalarAsync(ct);
    return Results.Ok(new { status = "ready" });
}).AllowAnonymous();

// Live updates: the browser connects here (WebSocket) with its access token. Closed when the token expires; the client reconnects with a fresh one.
app.MapHub<LiveHub>("/hubs/live", o => o.CloseOnAuthenticationExpiration = true);

app.MapDocs();   // Swagger UI at /docs when Swagger:Enabled is true

var api = app.MapGroup("/api/v1");
api.MapAuth();
api.MapMe();
api.MapOperations();
api.MapPeople();
api.MapTransfers();
api.MapReview();
api.MapImports();
api.MapPriceFeed();
api.MapNotifications();
api.MapGuide();

app.Run();

// Lets the test project start the API in memory later.
public partial class Program;