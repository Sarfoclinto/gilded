using GoldValuation.Infrastructure;
using GoldValuation.Infrastructure.Persistence;

namespace GoldValuation.Api;

/// <summary>
/// Operator commands, run from the project folder with <c>dotnet run --project src/GoldValuation.Api -- &lt;command&gt;</c>:
///   migrate                      apply database migrations not yet applied
///   baseline &lt;migration file&gt;    record migrations applied by hand (pgAdmin) so migrate can continue after them
///   seed --company x --company-name "X Ltd" --admin name --branch-code KSI --branch-name Kumasi [--display-name "Name"]
///        creates a company, its standard roles, its main branch and its first director (password from GOLD_SEED_PASSWORD or a prompt)
/// These use the "Migrator" connection (the owner login), never the application's.
/// </summary>
public static class Cli
{
    private static readonly string[] Commands = ["migrate", "baseline", "seed"];

    public static async Task<bool> TryRunAsync(string[] args)
    {
        if (args.Length == 0 || !Commands.Contains(args[0])) return false;

        var config = new ConfigurationBuilder()
            .AddJsonFile("appsettings.json", optional: false)
            .AddJsonFile("appsettings.Development.json", optional: true)
            .AddUserSecrets<Program>(optional: true)
            .AddEnvironmentVariables()
            .Build();
        using var loggers = LoggerFactory.Create(b => b.AddSimpleConsole().SetMinimumLevel(LogLevel.Information));

        switch (args[0])
        {
            case "migrate":
            {
                var ran = await InfrastructureModule.CreateMigrator(config, loggers).MigrateAsync();
                Console.WriteLine(ran.Count == 0 ? "Database is up to date." : $"Applied {ran.Count} migration(s): {string.Join(", ", ran)}");
                break;
            }
            case "baseline":
            {
                if (args.Length < 2) throw new ArgumentException("Usage: baseline <last migration file already applied>, e.g. baseline 0010_auth_support.sql");
                var recorded = await InfrastructureModule.CreateMigrator(config, loggers).BaselineAsync(args[1]);
                Console.WriteLine($"Recorded {recorded.Count} migration(s) as applied: {string.Join(", ", recorded)}");
                break;
            }
            case "seed":
            {
                var password = Environment.GetEnvironmentVariable("GOLD_SEED_PASSWORD") ?? PromptPassword();
                var request = new SeedRequest(
                    Required(args, "--company"), Required(args, "--company-name"),
                    Required(args, "--admin"), Option(args, "--display-name") ?? Required(args, "--admin"), password,
                    Required(args, "--branch-code"), Required(args, "--branch-name"));
                foreach (var line in await InfrastructureModule.CreateSeeder(config).SeedAsync(request)) Console.WriteLine(line);
                break;
            }
        }
        return true;
    }

    private static string? Option(string[] args, string name)
    {
        var i = Array.IndexOf(args, name);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
    }

    private static string Required(string[] args, string name) =>
        Option(args, name) ?? throw new ArgumentException($"Missing {name}. See the comment at the top of Cli.cs for usage.");

    private static string PromptPassword()
    {
        if (Console.IsInputRedirected) return Console.ReadLine() ?? string.Empty;
        Console.Write("Password for the first director (min 10 characters, hidden): ");
        var buffer = new System.Text.StringBuilder();
        while (true)
        {
            var key = Console.ReadKey(intercept: true);
            if (key.Key == ConsoleKey.Enter) break;
            if (key.Key == ConsoleKey.Backspace) { if (buffer.Length > 0) buffer.Length--; }
            else if (!char.IsControl(key.KeyChar)) buffer.Append(key.KeyChar);
        }
        Console.WriteLine();
        return buffer.ToString();
    }
}
