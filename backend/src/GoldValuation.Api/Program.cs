using GoldValuation.Api;
using GoldValuation.Api.Auth;
using GoldValuation.Api.Endpoints;
using GoldValuation.Infrastructure;
using Npgsql;

// Operator commands (migrate, baseline, seed) run and exit without starting the web server.
if (await Cli.TryRunAsync(args)) return;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddAuth(builder.Configuration);
builder.Services.AddProblemDetails();

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

app.MapDocs();   // Swagger UI at /docs when Swagger:Enabled is true

var api = app.MapGroup("/api/v1");
api.MapAuth();
api.MapMe();
api.MapOperations();
api.MapPeople();
api.MapTransfers();
api.MapReview();


app.Run();

// Lets the test project start the API in memory later.
public partial class Program;
