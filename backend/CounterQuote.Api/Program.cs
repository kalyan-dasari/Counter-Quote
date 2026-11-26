using CounterQuote.Api.Data;
using CounterQuote.Api.Models;
using CounterQuote.Api.Services;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

string dataFolder = Path.GetFullPath(builder.Configuration["DataFolder"] ?? "data", builder.Environment.ContentRootPath);
Directory.CreateDirectory(dataFolder);
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite($"Data Source={Path.Combine(dataFolder, "app.db")}"));

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.Migrate();

    if (!db.Jobs.Any())
    {
        Job kitchen = new()
        {
            CustomerName = "Sample: Kitchen",
            Material = "Granite",
            Thickness = "3cm",
            EdgeProfile = "Half Bullnose",
            CornerFinish = "Standard",
            IncludeTemplating = true,
            ShapeType = "l-shape",
            DesignJson = """{"points":[{"x":0,"y":0},{"x":108,"y":0},{"x":108,"y":25.5},{"x":25.5,"y":25.5},{"x":25.5,"y":78},{"x":0,"y":78}],"edges":[{"kind":"wall","backsplash":true},{"kind":"finished","backsplash":false},{"kind":"finished","backsplash":false},{"kind":"finished","backsplash":false},{"kind":"finished","backsplash":false},{"kind":"wall","backsplash":true}],"cutouts":[{"id":"c1","type":"undermount_sink","x":66,"y":13,"width":30,"height":18,"rotation":0},{"id":"c2","type":"faucet","x":66,"y":3,"width":2,"height":2,"rotation":0},{"id":"c3","type":"cooktop","x":13,"y":54,"width":20,"height":28,"rotation":0}]}""",
            Notes = "L-shape kitchen with 4\" matching backsplash, undermount sink, and slide-in cooktop cutout.",
            CreatedDate = DateTime.UtcNow
        };
        Job bathroom = new()
        {
            CustomerName = "Sample: Bathroom",
            Material = "Quartz",
            Thickness = "3cm",
            EdgeProfile = "Eased",
            CornerFinish = "Radius",
            IncludeTemplating = true,
            ShapeType = "rectangle",
            DesignJson = """{"points":[{"x":0,"y":0},{"x":60,"y":0},{"x":60,"y":22.5},{"x":0,"y":22.5}],"edges":[{"kind":"wall","backsplash":true},{"kind":"finished","backsplash":false},{"kind":"finished","backsplash":false},{"kind":"wall","backsplash":true}],"cutouts":[{"id":"c1","type":"undermount_sink","x":30,"y":11.5,"width":20,"height":15,"rotation":0},{"id":"c2","type":"faucet","x":30,"y":3,"width":2,"height":2,"rotation":0}]}""",
            Notes = "Guest bath vanity in alcove with right-side finished end and rounded front corner.",
            CreatedDate = DateTime.UtcNow
        };

        QuoteCalculator.ApplyQuote(kitchen);
        QuoteCalculator.ApplyQuote(bathroom);

        db.Jobs.AddRange(kitchen, bathroom);
        db.SaveChanges();
    }
}

app.UseSwagger();
app.UseSwaggerUI();
app.MapControllers();
app.Run();
