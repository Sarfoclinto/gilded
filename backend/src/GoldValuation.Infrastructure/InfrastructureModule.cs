using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;
using GoldValuation.Application.Imports;
using GoldValuation.Application.Operations;
using GoldValuation.Application.People;
using GoldValuation.Application.Notifications;
using GoldValuation.Application.Review;
using GoldValuation.Application.Transfers;
using GoldValuation.Infrastructure.Auth;
using GoldValuation.Infrastructure.Imports;
using GoldValuation.Infrastructure.Operations;
using GoldValuation.Infrastructure.People;
using GoldValuation.Infrastructure.Notifications;
using GoldValuation.Infrastructure.Review;
using GoldValuation.Infrastructure.Transfers;
using GoldValuation.Infrastructure.Persistence;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace GoldValuation.Infrastructure;

public static class InfrastructureModule
{
    /// <summary>Connection strings: "App" (gold_app, row-level security applies) and "Migrator" (owner, used only by the command-line tools).</summary>
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        var app = configuration.GetConnectionString("App")
                  ?? throw new InvalidOperationException("ConnectionStrings:App is not configured.");
        services.AddSingleton(_ => NpgsqlDataSource.Create(app));
        services.AddSingleton<IClock, SystemClock>();
        services.AddSingleton<IPasswordHasher, Pbkdf2PasswordHasher>();
        services.AddSingleton<IAuthStore, PostgresAuthStore>();
        services.AddSingleton<IOperationsStore, PostgresOperationsStore>();
        services.AddScoped<OperationsService>();
        services.AddSingleton<IPeopleStore, PostgresPeopleStore>();
        services.AddScoped<PeopleService>();
        services.AddSingleton<ITransfersStore, PostgresTransfersStore>();
        services.AddScoped<TransfersService>();
        services.AddSingleton<IReviewStore, PostgresReviewStore>();
        services.AddScoped<ReviewService>();
        services.AddSingleton<IImportsStore, PostgresImportsStore>();
        services.AddScoped<ImportsService>();
        services.AddSingleton<INotificationsStore, PostgresNotificationsStore>();
        services.AddScoped<NotificationsService>();
        return services;
    }

    public static SqlMigrator CreateMigrator(IConfiguration configuration, ILoggerFactory loggers) =>
        new(OwnerSource(configuration), loggers.CreateLogger<SqlMigrator>());

    public static Seeder CreateSeeder(IConfiguration configuration) =>
        new(OwnerSource(configuration), new Pbkdf2PasswordHasher());

    private static NpgsqlDataSource OwnerSource(IConfiguration configuration) =>
        NpgsqlDataSource.Create(configuration.GetConnectionString("Migrator")
                                ?? throw new InvalidOperationException("ConnectionStrings:Migrator is not configured."));

    private sealed class SystemClock : IClock
    {
        public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
    }
}
