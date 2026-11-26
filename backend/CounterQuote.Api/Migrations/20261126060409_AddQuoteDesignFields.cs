using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CounterQuote.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddQuoteDesignFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "AngledCorners",
                table: "Jobs",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<double>(
                name: "AreaSqFt",
                table: "Jobs",
                type: "REAL",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<double>(
                name: "BacksplashLinFt",
                table: "Jobs",
                type: "REAL",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<string>(
                name: "CornerFinish",
                table: "Jobs",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "CutoutCount",
                table: "Jobs",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "DesignJson",
                table: "Jobs",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "EdgeProfile",
                table: "Jobs",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<double>(
                name: "FinishedEdgeLinFt",
                table: "Jobs",
                type: "REAL",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<bool>(
                name: "IncludeRemoval",
                table: "Jobs",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IncludeTemplating",
                table: "Jobs",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "InsideCorners",
                table: "Jobs",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "Notes",
                table: "Jobs",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "OutsideFinishedCorners",
                table: "Jobs",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "ShapeType",
                table: "Jobs",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Thickness",
                table: "Jobs",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<decimal>(
                name: "TotalPrice",
                table: "Jobs",
                type: "TEXT",
                nullable: false,
                defaultValue: 0m);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AngledCorners",
                table: "Jobs");

            migrationBuilder.DropColumn(
                name: "AreaSqFt",
                table: "Jobs");

            migrationBuilder.DropColumn(
                name: "BacksplashLinFt",
                table: "Jobs");

            migrationBuilder.DropColumn(
                name: "CornerFinish",
                table: "Jobs");

            migrationBuilder.DropColumn(
                name: "CutoutCount",
                table: "Jobs");

            migrationBuilder.DropColumn(
                name: "DesignJson",
                table: "Jobs");

            migrationBuilder.DropColumn(
                name: "EdgeProfile",
                table: "Jobs");

            migrationBuilder.DropColumn(
                name: "FinishedEdgeLinFt",
                table: "Jobs");

            migrationBuilder.DropColumn(
                name: "IncludeRemoval",
                table: "Jobs");

            migrationBuilder.DropColumn(
                name: "IncludeTemplating",
                table: "Jobs");

            migrationBuilder.DropColumn(
                name: "InsideCorners",
                table: "Jobs");

            migrationBuilder.DropColumn(
                name: "Notes",
                table: "Jobs");

            migrationBuilder.DropColumn(
                name: "OutsideFinishedCorners",
                table: "Jobs");

            migrationBuilder.DropColumn(
                name: "ShapeType",
                table: "Jobs");

            migrationBuilder.DropColumn(
                name: "Thickness",
                table: "Jobs");

            migrationBuilder.DropColumn(
                name: "TotalPrice",
                table: "Jobs");
        }
    }
}
