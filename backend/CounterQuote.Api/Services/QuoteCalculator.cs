using System.Text.Json;
using CounterQuote.Api.Models;

namespace CounterQuote.Api.Services;

public record PointDto(double X, double Y);

public record EdgeDto(string Kind = "finished", bool Backsplash = false);

public record CutoutDto(string Id = "", string Type = "undermount_sink", double X = 0, double Y = 0, double Width = 30, double Height = 18, double Rotation = 0);

public record CounterDesignDto(
    List<PointDto>? Points,
    List<EdgeDto>? Edges,
    List<CutoutDto>? Cutouts);

public record GeometryMetrics(
    double AreaSqFt,
    double FinishedEdgeLinFt,
    double BacksplashLinFt,
    int InsideCorners,
    int OutsideFinishedCorners,
    int AngledCorners,
    int CutoutCount,
    int EstimatedSlabs);

public static class QuoteCalculator
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public static readonly IReadOnlyDictionary<string, decimal> MaterialRatesPerSqFt =
        new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase)
        {
            ["Granite"] = 68m,
            ["Quartz"] = 82m,
            ["Marble"] = 108m,
            ["Quartzite"] = 120m,
        };

    public static readonly IReadOnlyDictionary<string, decimal> ThicknessAddersPerSqFt =
        new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase)
        {
            ["2cm"] = 0m,
            ["3cm"] = 10m,
        };

    public static readonly IReadOnlyDictionary<string, decimal> EdgeRatesPerLinFt =
        new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase)
        {
            ["Eased"] = 0m,
            ["Half Bullnose"] = 12m,
            ["Bevel"] = 14m,
            ["Full Bullnose"] = 18m,
            ["Ogee"] = 28m,
            ["Mitered"] = 42m,
        };

    public static readonly IReadOnlyDictionary<string, decimal> CornerFinishRates =
        new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase)
        {
            ["Standard"] = 0m,
            ["Radius"] = 35m,
            ["Clipped"] = 45m,
        };

    public static readonly IReadOnlyDictionary<string, decimal> CutoutPrices =
        new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase)
        {
            ["undermount_sink"] = 185m,
            ["dropin_sink"] = 110m,
            ["cooktop"] = 165m,
            ["faucet"] = 25m,
        };

    public const decimal WasteFactor = 0.10m;
    public const decimal InsideCornerPrice = 85m;
    public const decimal AngledCornerPrice = 65m;
    public const decimal BacksplashRatePerLinFt = 22m;
    public const decimal TemplatingFlatFee = 250m;
    public const decimal RemovalRatePerSqFt = 10m;
    public const decimal MinimumJobCharge = 550m;
    public const double UsableSqFtPerSlab = 50.0;

    /// <summary>
    /// Parses the stored polygon and cutout design and computes geometric and pricing totals on the job.
    /// </summary>
    public static void ApplyQuote(Job job)
    {
        CounterDesignDto? design = ParseDesign(job.DesignJson);
        if (design is null || design.Points is null || design.Points.Count < 3)
        {
            job.AreaSqFt = 0;
            job.FinishedEdgeLinFt = 0;
            job.BacksplashLinFt = 0;
            job.InsideCorners = 0;
            job.OutsideFinishedCorners = 0;
            job.AngledCorners = 0;
            job.CutoutCount = 0;
            job.TotalPrice = 0;
            return;
        }

        GeometryMetrics metrics = ComputeMetrics(design);
        job.AreaSqFt = metrics.AreaSqFt;
        job.FinishedEdgeLinFt = metrics.FinishedEdgeLinFt;
        job.BacksplashLinFt = metrics.BacksplashLinFt;
        job.InsideCorners = metrics.InsideCorners;
        job.OutsideFinishedCorners = metrics.OutsideFinishedCorners;
        job.AngledCorners = metrics.AngledCorners;
        job.CutoutCount = metrics.CutoutCount;
        job.TotalPrice = CalculateTotal(job, design, metrics);
    }

    public static CounterDesignDto? ParseDesign(string? designJson)
    {
        if (string.IsNullOrWhiteSpace(designJson))
            return null;

        try
        {
            return JsonSerializer.Deserialize<CounterDesignDto>(designJson, JsonOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public static GeometryMetrics ComputeMetrics(CounterDesignDto design)
    {
        List<PointDto> pts = design.Points ?? [];
        int n = pts.Count;
        if (n < 3)
            return new GeometryMetrics(0, 0, 0, 0, 0, 0, 0, 0);

        double signedArea2 = 0;
        for (int i = 0; i < n; i++)
        {
            PointDto a = pts[i];
            PointDto b = pts[(i + 1) % n];
            signedArea2 += (a.X * b.Y) - (b.X * a.Y);
        }

        double areaSqIn = Math.Abs(signedArea2) / 2.0;
        double areaSqFt = Math.Round(areaSqIn / 144.0, 2);
        double orientationSign = signedArea2 >= 0 ? 1.0 : -1.0;

        List<EdgeDto> edges = design.Edges ?? [];
        double finishedInches = 0;
        double backsplashInches = 0;

        for (int i = 0; i < n; i++)
        {
            PointDto a = pts[i];
            PointDto b = pts[(i + 1) % n];
            double len = Math.Hypot(b.X - a.X, b.Y - a.Y);
            EdgeDto edge = i < edges.Count ? edges[i] : new EdgeDto();

            if (string.Equals(edge.Kind, "finished", StringComparison.OrdinalIgnoreCase))
            {
                finishedInches += len;
            }
            else if (string.Equals(edge.Kind, "wall", StringComparison.OrdinalIgnoreCase) && edge.Backsplash)
            {
                backsplashInches += len;
            }
        }

        int insideCorners = 0;
        int outsideFinishedCorners = 0;
        int angledCorners = 0;

        for (int i = 0; i < n; i++)
        {
            PointDto prev = pts[(i - 1 + n) % n];
            PointDto curr = pts[i];
            PointDto next = pts[(i + 1) % n];

            double v1x = curr.X - prev.X;
            double v1y = curr.Y - prev.Y;
            double v2x = next.X - curr.X;
            double v2y = next.Y - curr.Y;

            double len1 = Math.Hypot(v1x, v1y);
            double len2 = Math.Hypot(v2x, v2y);
            if (len1 < 1e-4 || len2 < 1e-4)
                continue;

            double cross = (v1x * v2y) - (v1y * v2x);
            double dot = (v1x * v2x) + (v1y * v2y);
            double turnAngleDeg = Math.Abs(Math.Atan2(Math.Abs(cross), dot) * (180.0 / Math.PI));

            // Ignore nearly collinear vertices.
            if (turnAngleDeg < 5.0 || turnAngleDeg > 175.0)
                continue;

            double orientedCross = cross * orientationSign;
            if (orientedCross < -1e-4)
            {
                insideCorners++;
            }
            else if (orientedCross > 1e-4)
            {
                EdgeDto prevEdge = ((i - 1 + n) % n) < edges.Count ? edges[(i - 1 + n) % n] : new EdgeDto();
                EdgeDto nextEdge = i < edges.Count ? edges[i] : new EdgeDto();
                if (string.Equals(prevEdge.Kind, "finished", StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(nextEdge.Kind, "finished", StringComparison.OrdinalIgnoreCase))
                {
                    outsideFinishedCorners++;
                }
            }

            if (Math.Abs(turnAngleDeg - 90.0) > 2.0)
            {
                angledCorners++;
            }
        }

        int cutoutCount = design.Cutouts?.Count ?? 0;
        int estimatedSlabs = areaSqFt > 0
            ? (int)Math.Ceiling((areaSqFt * (1.0 + (double)WasteFactor)) / UsableSqFtPerSlab)
            : 0;

        return new GeometryMetrics(
            AreaSqFt: areaSqFt,
            FinishedEdgeLinFt: Math.Round(finishedInches / 12.0, 2),
            BacksplashLinFt: Math.Round(backsplashInches / 12.0, 2),
            InsideCorners: insideCorners,
            OutsideFinishedCorners: outsideFinishedCorners,
            AngledCorners: angledCorners,
            CutoutCount: cutoutCount,
            EstimatedSlabs: estimatedSlabs);
    }

    private static decimal CalculateTotal(Job job, CounterDesignDto design, GeometryMetrics metrics)
    {
        if (metrics.AreaSqFt <= 0)
            return 0m;

        decimal materialRate = MaterialRatesPerSqFt.GetValueOrDefault(job.Material, 68m);
        decimal thicknessAdder = ThicknessAddersPerSqFt.GetValueOrDefault(job.Thickness, 0m);
        decimal area = (decimal)metrics.AreaSqFt;

        decimal materialCost = area * (materialRate + thicknessAdder);
        decimal wasteCost = materialCost * WasteFactor;

        decimal edgeRate = EdgeRatesPerLinFt.GetValueOrDefault(job.EdgeProfile, 0m);
        decimal edgeCost = (decimal)metrics.FinishedEdgeLinFt * edgeRate;

        decimal insideCornerCost = metrics.InsideCorners * InsideCornerPrice;
        decimal outsideCornerRate = CornerFinishRates.GetValueOrDefault(job.CornerFinish, 0m);
        decimal outsideCornerCost = metrics.OutsideFinishedCorners * outsideCornerRate;
        decimal angledCornerCost = metrics.AngledCorners * AngledCornerPrice;

        decimal backsplashCost = (decimal)metrics.BacksplashLinFt * BacksplashRatePerLinFt;

        decimal cutoutCost = 0m;
        if (design.Cutouts is not null)
        {
            foreach (CutoutDto cutout in design.Cutouts)
            {
                cutoutCost += CutoutPrices.GetValueOrDefault(cutout.Type, 150m);
            }
        }

        decimal templatingCost = job.IncludeTemplating ? TemplatingFlatFee : 0m;
        decimal removalCost = job.IncludeRemoval ? area * RemovalRatePerSqFt : 0m;

        decimal subtotal = materialCost
            + wasteCost
            + edgeCost
            + insideCornerCost
            + outsideCornerCost
            + angledCornerCost
            + backsplashCost
            + cutoutCost
            + templatingCost
            + removalCost;

        decimal total = Math.Max(subtotal, MinimumJobCharge);
        return Math.Round(total, 2, MidpointRounding.AwayFromZero);
    }
}
