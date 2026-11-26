using System.ComponentModel.DataAnnotations;

namespace CounterQuote.Api.Models;

public class Job
{
    public int Id { get; set; }

    [Required]
    public string CustomerName { get; set; } = "";

    public string Material { get; set; } = "Granite";

    public string Thickness { get; set; } = "3cm";

    public string EdgeProfile { get; set; } = "Eased";

    public string CornerFinish { get; set; } = "Standard";

    public bool IncludeTemplating { get; set; } = true;

    public bool IncludeRemoval { get; set; }

    public string ShapeType { get; set; } = "rectangle";

    public string DesignJson { get; set; } = "";

    public double AreaSqFt { get; set; }

    public double FinishedEdgeLinFt { get; set; }

    public double BacksplashLinFt { get; set; }

    public int InsideCorners { get; set; }

    public int OutsideFinishedCorners { get; set; }

    public int AngledCorners { get; set; }

    public int CutoutCount { get; set; }

    public decimal TotalPrice { get; set; }

    public string Notes { get; set; } = "";

    public DateTime CreatedDate { get; set; }
}
