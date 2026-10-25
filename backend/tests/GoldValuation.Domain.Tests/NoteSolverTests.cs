using System.Text.Json;
using GoldValuation.Domain.Notes;
using Xunit;

namespace GoldValuation.Domain.Tests;

public class NoteSolverTests
{
    private static Dictionary<int, int?> Limits(JsonElement limits)
    {
        var map = new Dictionary<int, int?>();
        foreach (var p in limits.EnumerateObject())
        {
            map[int.Parse(p.Name)] = p.Value.ValueKind == JsonValueKind.Null ? null : p.Value.GetInt32();
        }
        return map;
    }

    private static SolveStrategy Strategy(string s) => s == "prefer-100s" ? SolveStrategy.Prefer100s : SolveStrategy.FewestNotes;

    public static IEnumerable<object[]> SharedCases()
    {
        foreach (var c in Vectors.Load("solver-cases.json").GetProperty("cases").EnumerateArray())
        {
            yield return [c.GetProperty("name").GetString()!, c.GetRawText()];
        }
    }

    [Theory]
    [MemberData(nameof(SharedCases))]
    public void Matches_the_shared_case(string name, string json)
    {
        using var doc = JsonDocument.Parse(json);
        var c = doc.RootElement;
        var expect = c.GetProperty("expect");
        var amount = c.GetProperty("amount").GetInt32();
        var r = NoteSolver.Solve(amount, Limits(c.GetProperty("limits")), Strategy(c.GetProperty("strategy").GetString()!));

        Assert.True(r.Ok == expect.GetProperty("ok").GetBoolean(), name);
        if (r.Ok)
        {
            Assert.Equal(amount, r.Lines.Sum(kv => kv.Key * kv.Value));
            if (expect.TryGetProperty("totalNotes", out var total)) Assert.Equal(total.GetInt32(), r.TotalNotes);
            if (expect.TryGetProperty("hundreds", out var hundreds)) Assert.Equal(hundreds.GetInt32(), r.Hundreds);
            if (expect.TryGetProperty("lines", out var lines))
            {
                var expected = lines.EnumerateObject().ToDictionary(p => int.Parse(p.Name), p => p.Value.GetInt32());
                Assert.Equal(expected.OrderBy(kv => kv.Key), r.Lines.OrderBy(kv => kv.Key));
            }
        }
        else
        {
            Assert.Equal(expect.GetProperty("code").GetString(), r.ErrorCode);
            if (expect.TryGetProperty("nearestBelow", out var below)) Assert.Equal(NullableInt(below), r.NearestBelow);
            if (expect.TryGetProperty("nearestAbove", out var above)) Assert.Equal(NullableInt(above), r.NearestAbove);
        }
    }

    private static int? NullableInt(JsonElement e) => e.ValueKind == JsonValueKind.Null ? null : e.GetInt32();

    public static IEnumerable<object[]> PayableCases()
    {
        foreach (var p in Vectors.Load("solver-cases.json").GetProperty("payable").EnumerateArray())
        {
            yield return [p.GetRawText()];
        }
    }

    [Theory]
    [MemberData(nameof(PayableCases))]
    public void Rounds_to_a_payable_amount(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var p = doc.RootElement;
        var policy = p.GetProperty("policy").GetString() switch { "up" => PayablePolicy.Up, "nearest" => PayablePolicy.Nearest, _ => PayablePolicy.Down };
        var r = NoteSolver.ToPayable(p.GetProperty("amount").GetInt32(), policy);
        Assert.Equal(p.GetProperty("payable").GetInt32(), r.Payable);
        Assert.Equal(p.GetProperty("difference").GetInt32(), r.Difference);
    }

    [Fact]
    public void Describes_1688_notes_as_a_pack_six_bundles_and_88_loose()
    {
        Assert.Equal(new CountDisplay(1, 6, 88, 1688), NoteSolver.Describe(1688));
    }

    [Fact]
    public void Matches_brute_force_on_random_drawers()
    {
        var rng = new Random(12345);
        for (var t = 0; t < 300; t++)
        {
            var limits = new Dictionary<int, int?>();
            foreach (var d in NoteSolver.Denominations)
            {
                var r = rng.NextDouble();
                if (r < 0.25) continue;
                limits[d] = r < 0.4 ? null : rng.Next(0, 8);
            }
            var amount = rng.Next(0, 120) * 5;
            var strategy = rng.NextDouble() < 0.5 ? SolveStrategy.FewestNotes : SolveStrategy.Prefer100s;

            var best = Brute(amount, limits, strategy);
            var got = NoteSolver.Solve(amount, limits, strategy);
            Assert.Equal(best is not null, got.Ok);
            if (best is { } b && got.Ok)
            {
                Assert.Equal(b.Notes, got.TotalNotes);
                Assert.Equal(b.Hundreds, got.Hundreds);
            }
        }
    }

    private static (int Notes, int Hundreds)? Brute(int amount, Dictionary<int, int?> limits, SolveStrategy strategy)
    {
        var denoms = NoteSolver.Denominations.Where(limits.ContainsKey).ToArray();
        (int Notes, int Hundreds)? best = null;

        void Go(int i, int left, int notes, int hundreds)
        {
            if (i == denoms.Length)
            {
                if (left != 0) return;
                var better = best is null
                    || (strategy == SolveStrategy.Prefer100s
                        ? hundreds > best.Value.Hundreds || (hundreds == best.Value.Hundreds && notes < best.Value.Notes)
                        : notes < best.Value.Notes);
                if (better) best = (notes, hundreds);
                return;
            }
            var d = denoms[i];
            var max = Math.Min(limits[d] ?? int.MaxValue, left / d);
            for (var n = 0; n <= max; n++) Go(i + 1, left - n * d, notes + n, hundreds + (d == 100 ? n : 0));
        }

        Go(0, amount, 0, 0);
        return best;
    }
}
