using CounterQuote.Api.Controllers;
using CounterQuote.Api.Data;
using CounterQuote.Api.Models;
using CounterQuote.Api.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace CounterQuote.Api.Tests;

public class JobsControllerTests : IDisposable
{
    private readonly SqliteConnection _connection = new("Data Source=:memory:");

    public JobsControllerTests()
    {
        _connection.Open();
        using AppDbContext db = CreateDb();
        db.Database.Migrate();
    }

    public void Dispose() => _connection.Dispose();

    private AppDbContext CreateDb() => new(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_connection).Options);

    [Fact]
    public async Task Created_job_can_be_read_back()
    {
        using (AppDbContext db = CreateDb())
            await new JobsController(db).Create(new Job { CustomerName = "Rivera", Material = "Quartz" });

        using AppDbContext readDb = CreateDb();
        Job job = Assert.Single(await new JobsController(readDb).GetAll());
        Assert.Equal("Rivera", job.CustomerName);
        Assert.Equal("Quartz", job.Material);
    }

    [Fact]
    public async Task Updating_a_job_saves_the_changes_and_keeps_its_created_date()
    {
        using AppDbContext db = CreateDb();
        db.Jobs.Add(new Job { CustomerName = "Rivera", Material = "Quartz", CreatedDate = new DateTime(2026, 1, 2) });
        db.SaveChanges();
        int id = db.Jobs.Single().Id;

        await new JobsController(db).Update(id, new Job { CustomerName = "Rivera", Material = "Marble" });

        using AppDbContext readDb = CreateDb();
        Job job = readDb.Jobs.Single();
        Assert.Equal("Marble", job.Material);
        Assert.Equal(new DateTime(2026, 1, 2), job.CreatedDate);
    }

    [Fact]
    public async Task Creating_job_with_design_calculates_and_persists_quote_metrics()
    {
        // 72" x 24" rectangle = 12 sq ft; 1 wall edge with backsplash (6 ft), 3 finished edges (10 ft)
        string design = """
        {
          "points": [{"x":0,"y":0},{"x":72,"y":0},{"x":72,"y":24},{"x":0,"y":24}],
          "edges": [
            {"kind":"wall","backsplash":true},
            {"kind":"finished","backsplash":false},
            {"kind":"finished","backsplash":false},
            {"kind":"finished","backsplash":false}
          ],
          "cutouts": [
            {"id":"s1","type":"undermount_sink","x":36,"y":12,"width":30,"height":18,"rotation":0}
          ]
        }
        """;

        using (AppDbContext db = CreateDb())
        {
            await new JobsController(db).Create(new Job
            {
                CustomerName = "Nguyen",
                Material = "Quartz",
                Thickness = "3cm",
                EdgeProfile = "Half Bullnose",
                CornerFinish = "Standard",
                IncludeTemplating = true,
                ShapeType = "rectangle",
                DesignJson = design
            });
        }

        using AppDbContext readDb = CreateDb();
        Job saved = readDb.Jobs.Single();
        Assert.Equal(12.0, saved.AreaSqFt);
        Assert.Equal(10.0, saved.FinishedEdgeLinFt);
        Assert.Equal(6.0, saved.BacksplashLinFt);
        Assert.Equal(0, saved.InsideCorners);
        Assert.Equal(2, saved.OutsideFinishedCorners);
        Assert.Equal(1, saved.CutoutCount);
        Assert.True(saved.TotalPrice > 1500m);
    }

    [Fact]
    public void L_shape_and_U_shape_detect_inside_corners_accurately()
    {
        string lShapeJson = """
        {
          "points": [{"x":0,"y":0},{"x":96,"y":0},{"x":96,"y":24},{"x":24,"y":24},{"x":24,"y":72},{"x":0,"y":72}],
          "edges": [
            {"kind":"wall","backsplash":true},
            {"kind":"finished","backsplash":false},
            {"kind":"finished","backsplash":false},
            {"kind":"finished","backsplash":false},
            {"kind":"finished","backsplash":false},
            {"kind":"wall","backsplash":true}
          ],
          "cutouts": []
        }
        """;

        string uShapeJson = """
        {
          "points": [{"x":0,"y":0},{"x":108,"y":0},{"x":108,"y":72},{"x":84,"y":72},{"x":84,"y":24},{"x":24,"y":24},{"x":24,"y":72},{"x":0,"y":72}],
          "edges": [
            {"kind":"wall","backsplash":true},
            {"kind":"wall","backsplash":true},
            {"kind":"finished","backsplash":false},
            {"kind":"finished","backsplash":false},
            {"kind":"finished","backsplash":false},
            {"kind":"finished","backsplash":false},
            {"kind":"finished","backsplash":false},
            {"kind":"wall","backsplash":true}
          ],
          "cutouts": []
        }
        """;

        GeometryMetrics lMetrics = QuoteCalculator.ComputeMetrics(QuoteCalculator.ParseDesign(lShapeJson)!);
        GeometryMetrics uMetrics = QuoteCalculator.ComputeMetrics(QuoteCalculator.ParseDesign(uShapeJson)!);

        Assert.Equal(1, lMetrics.InsideCorners);
        Assert.Equal(0, lMetrics.AngledCorners);
        Assert.Equal(24.0, lMetrics.AreaSqFt); // (96*24 + 48*24) / 144 = 24

        Assert.Equal(2, uMetrics.InsideCorners);
        Assert.Equal(0, uMetrics.AngledCorners);
        Assert.Equal(34.0, uMetrics.AreaSqFt); // (108*24 + 48*24 + 48*24) / 144 = 34
    }

    [Fact]
    public void Non_orthogonal_shape_detects_angled_corners()
    {
        // Angled L-shape with a 45-degree chamfered leg
        string angledJson = """
        {
          "points": [{"x":0,"y":0},{"x":72,"y":0},{"x":84,"y":24},{"x":0,"y":24}],
          "edges": [
            {"kind":"wall","backsplash":false},
            {"kind":"finished","backsplash":false},
            {"kind":"finished","backsplash":false},
            {"kind":"finished","backsplash":false}
          ],
          "cutouts": []
        }
        """;

        GeometryMetrics metrics = QuoteCalculator.ComputeMetrics(QuoteCalculator.ParseDesign(angledJson)!);
        Assert.Equal(2, metrics.AngledCorners);
        Assert.Equal(13.0, metrics.AreaSqFt); // trapezoid (72 + 84)/2 * 24 / 144 = 13 sq ft
    }
}
