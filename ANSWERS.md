# Answers

- **Name:**
- **Email** (the one you applied with):
- **Phone** (optional):

## 1. What did you need to research, and how did you do it?

I researched how stone countertop fabricators estimate jobs in practice — specifically how shops combine square-foot material + fabrication rates, linear-foot edge profile upgrades, cutout fees, inside corner relief/seaming, and backsplash charges:
- **Square-foot pricing & waste:** Most shops quote installed base rates per sq. ft. by stone type and thickness (2cm vs. 3cm), plus a slab yield/waste allowance (~10–15%) and a minimum job charge for small vanities.
- **Edges & corners:** Standard eased edges are typically included in the base rate, while upgraded profiles (Half Bullnose, Bevel, Full Bullnose, Ogee, Mitered) add per-linear-foot charges *only on finished/exposed edges* (not against walls). Concave inside corners (in L- and U-shapes) require CNC radius relief or precision seams, and non-90° walls add templating/setup complexity.
- **Cutouts & backsplashes:** Undermount sinks cost more than drop-ins because the interior rim must be CNC-polished; cooktops and core-drilled faucet holes are billed per cutout; matching 4" backsplashes are billed per linear foot along wall edges.
- References consulted:
  - Craft Counters — Countertop pricing & cutout/edge breakdown: https://craftcounters.com
  - SlabWise — Stone fabrication inside corner radius & complexity quoting: https://slabwise.com

## 2. How did you decide what to charge for, and how?

I built a single transparent, itemized pricing model in both [QuoteCalculator.cs](backend/CounterQuote.Api/Services/QuoteCalculator.cs) (authoritative on save) and [quote.ts](frontend/src/quote.ts) (instant live preview while drawing):
- **Material & thickness:** Granite ($68/sf), Quartz ($82/sf), Marble ($108/sf), Quartzite ($120/sf), plus +$10/sf for 3cm slabs vs. 2cm, plus a 10% slab waste & yield factor (and an estimated 50 sq. ft. usable slab count).
- **Finished edges vs. walls:** Only edges marked *Finished* are multiplied by the selected edge profile upcharge (Eased $0, Half Bullnose $12/lf, Bevel $14/lf, Full Bullnose $18/lf, Ogee $28/lf, Mitered $42/lf). Edges marked *Wall* can toggle a 4" matching backsplash ($22/lf).
- **Corners:** Automatically detected from the polygon geometry — inside/reflex corners ($85 each), exposed finished outside corner upgrades (Standard $0, Radius $35, Clipped $45), and non-90° angled corners ($65 each).
- **Cutouts & shop services:** Undermount Sink ($185), Drop-In Sink ($110), Cooktop ($165), Faucet Hole ($25), optional Laser Templating & Install ($250 flat), optional Old Counter Tear-Out ($10/sf), and a $550 shop minimum.

## 3. How did you use AI? Where did it help, and how did you lead it?

AI helped accelerate boilerplate across the EF Core migration, SVG geometry/hit-testing, and matching TypeScript/C# pricing calculations. I directed the architecture around a unified 2D polygon + per-edge metadata + draggable cutout schema (`DesignJson`), verified the polygon shoelace area and cross-product inside-corner math against hand-calculated test cases in xUnit (`JobsControllerTests.cs`), and insisted on server-side recalculation on `POST`/`PUT` so saved totals cannot drift from the drawing.

## 4. What would you ask an industry expert to check or improve this?

- How their shop handles **slab nesting / whole-slab billing** when a kitchen is just slightly over one slab (e.g., 52 sq. ft. forcing a second slab purchase vs. selling by the sq. ft. from remnants).
- Maximum continuous piece lengths before requiring a **field seam** (e.g., >120" runs or access constraints around elevators/stairs) and whether seam placement should be drawn manually on the canvas.
- Whether **overhang support brackets** (for breakfast bars >10–12") and **mitered waterfall legs** should be first-class edge/attachment options.

## 5. What did you leave out, and what would you work on next?

- **Left out:** Full 2D slab-nesting / vein-direction layout optimizer, seam placement tools, custom cutout dimensions editor, and PDF export (currently uses browser `Print Quote` styling).
- **Next:** Add seam-line placement with max-slab-length warnings, slab-sheet nesting preview, and shop-configurable price books stored in SQLite instead of static constants.

## How to run it

From a fresh unzip, install **.NET SDK 8.0+** and **Node.js 20.19+ / 22.12+** (or use Docker):

**Without Docker** (two terminals from the project root):
1. Terminal 1 (API on `http://localhost:5080`, Swagger at `http://localhost:5080/swagger`):
   ```powershell
   cd backend/CounterQuote.Api
   dotnet run
   ```
2. Terminal 2 (Web app on `http://localhost:5173`):
   ```powershell
   cd frontend
   npm install
   npm run dev
   ```
3. Open `http://localhost:5173`. Run backend tests anytime from `backend/` with `dotnet test`.

## What we should know to evaluate it

1. **Pre-seeded sample jobs:** Open **Sample: Kitchen** (L-shape Granite with inside corner, backsplash, sink, faucet, cooktop) or **Sample: Bathroom** (Quartz alcove vanity) from the home list, or click **+ New Quote**.
2. **Parametric + direct manipulation:** Switch between **Rectangle**, **L-Shape** (includes an adjustable **Corner Angle °** for non-90° walls), **U-Shape**, and **Draw Freehand / Custom**.
3. **Interactive canvas features:**
   - Drag any corner handle to resize or create custom angles; watch area, edge lengths, inside-corner detection, and the itemized quote update live.
   - Click any edge to toggle **Finished Edge vs. Wall Edge**, toggle **4" Backsplash**, **Split Edge**, or add a **+ 6" Bumpout**.
   - Add and drag **Undermount Sink**, **Drop-In Sink**, **Cooktop**, or **Faucet Hole** cutouts directly on the counter (click a cutout to rotate 90° or remove).
4. **Known limitations:** Freehand polygons assume non-self-intersecting outlines; `Print Quote` relies on browser print-to-PDF.

## Screenshots

*(Add 2–3 screenshots of the running app here before submitting.)*
