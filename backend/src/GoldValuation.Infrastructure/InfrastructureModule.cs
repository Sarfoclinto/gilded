using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Attachments;
using GoldValuation.Application.Personal;
using GoldValuation.Infrastructure.Personal;
using GoldValuation.Application.Auth;
using GoldValuation.Application.Imports;
using GoldValuation.Application.PriceFeed;
using GoldValuation.Application.Operations;
using GoldValuation.Application.People;
using GoldValuation.Application.Guide;
using GoldValuation.Application.Sync;
using GoldValuation.Application.Notifications;
using GoldValuation.Application.Review;
using GoldValuation.Application.Transfers;
using GoldValuation.Infrastructure.Attachments;
using GoldValuation.Infrastructure.Auth;
using GoldValuation.Infrastructure.Imports;
using GoldValuation.Infrastructure.PriceFeed;
using GoldValuation.Infrastructure.Operations;
using GoldValuation.Infrastructure.People;
using GoldValuation.Infrastructure.Guide;
using GoldValuation.Infrastructure.Sync;
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
        services.AddSingleton<IPriceFeedStore, PostgresPriceFeedStore>();
        services.AddHttpClient<IGoldbodClient, GoldbodHttpClient>(c =>
        {
            c.BaseAddress = new Uri(configuration["PriceFeed:Url"] ?? "https://goldbod.gov.gh/");
            c.Timeout = TimeSpan.FromSeconds(20);
            c.DefaultRequestHeaders.UserAgent.ParseAdd("Gilded/1.0 (+gold price reader)");
        });
        services.AddScoped<PriceFeedService>();
        services.AddSingleton<INotificationsStore, PostgresNotificationsStore>();
        services.AddScoped<NotificationsService>();
        services.AddSingleton<IGuideStore, PostgresGuideStore>();
        services.AddScoped<GuideService>();
        services.AddSingleton<ISyncStore, PostgresSyncStore>();
        services.AddSingleton<ICommandVerifier, EcdsaCommandVerifier>();
        services.AddScoped<SyncService>();
        services.AddSingleton<IAttachmentsStore, PostgresAttachmentsStore>();
        // Pictures live as files under one folder: the photos volume in production (see deploy/docker-compose.yml).
        var photos = configuration["Photos:Path"] ?? Path.Combine(AppContext.BaseDirectory, "photos");
        services.AddSingleton<IBlobStore>(_ => new FileBlobStore(photos));
        services.AddScoped<AttachmentsService>();
        services.AddSingleton<IPersonalPicturesStore, PostgresPersonalPicturesStore>();
        services.AddScoped<PersonalPicturesService>();
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