import type { CounterDesign, CounterEdge, CutoutType, Job, Point, ShapeType } from './types';

export interface MaterialOption {
  name: string;
  ratePerSqFt: number;
  swatch: string;
  description: string;
}

export const MATERIALS: MaterialOption[] = [
  { name: 'Granite', ratePerSqFt: 68, swatch: '#8b8378', description: 'Natural stone, durable & heat resistant' },
  { name: 'Quartz', ratePerSqFt: 82, swatch: '#d9d6cf', description: 'Engineered stone, non-porous & low maintenance' },
  { name: 'Marble', ratePerSqFt: 108, swatch: '#ecebe6', description: 'Classic veined natural stone' },
  { name: 'Quartzite', ratePerSqFt: 120, swatch: '#b8b4aa', description: 'Hard natural stone with marble-like veining' },
];

export const THICKNESSES = [
  { name: '2cm', label: '2 cm (3/4")', adderPerSqFt: 0 },
  { name: '3cm', label: '3 cm (1-1/4")', adderPerSqFt: 10 },
];

export const EDGE_PROFILES = [
  { name: 'Eased', ratePerLinFt: 0, note: 'Included in base fabrication' },
  { name: 'Half Bullnose', ratePerLinFt: 12, note: 'Rounded top edge' },
  { name: 'Bevel', ratePerLinFt: 14, note: '45° angled top chamfer' },
  { name: 'Full Bullnose', ratePerLinFt: 18, note: 'Fully rounded half-circle edge' },
  { name: 'Ogee', ratePerLinFt: 28, note: 'Classic S-curve decorative profile' },
  { name: 'Mitered', ratePerLinFt: 42, note: '2"+ thick laminated waterfall look' },
];

export const CORNER_FINISHES = [
  { name: 'Standard', ratePerCorner: 0, note: 'Standard 1/8" eased corner' },
  { name: 'Radius', ratePerCorner: 35, note: '1"–3" rounded safety corner' },
  { name: 'Clipped', ratePerCorner: 45, note: '45° chamfered corner' },
];

export const CUTOUT_CATALOG: Record<
  CutoutType,
  { label: string; price: number; defaultWidth: number; defaultHeight: number; shortLabel: string }
> = {
  undermount_sink: {
    label: 'Undermount Sink',
    shortLabel: 'Undermount Sink',
    price: 185,
    defaultWidth: 30,
    defaultHeight: 18,
  },
  dropin_sink: {
    label: 'Drop-In Sink',
    shortLabel: 'Drop-In Sink',
    price: 110,
    defaultWidth: 32,
    defaultHeight: 20,
  },
  cooktop: {
    label: 'Cooktop / Range',
    shortLabel: 'Cooktop',
    price: 165,
    defaultWidth: 30,
    defaultHeight: 21,
  },
  faucet: {
    label: 'Faucet / Soap Hole',
    shortLabel: 'Faucet',
    price: 25,
    defaultWidth: 2,
    defaultHeight: 2,
  },
};

export const WASTE_FACTOR = 0.1;
export const INSIDE_CORNER_PRICE = 85;
export const ANGLED_CORNER_PRICE = 65;
export const BACKSPLASH_RATE_PER_LIN_FT = 22;
export const TEMPLATING_FLAT_FEE = 250;
export const REMOVAL_RATE_PER_SQ_FT = 10;
export const MINIMUM_JOB_CHARGE = 550;
export const USABLE_SQ_FT_PER_SLAB = 50;

export interface GeometryMetrics {
  areaSqFt: number;
  finishedEdgeLinFt: number;
  backsplashLinFt: number;
  insideCorners: number;
  outsideFinishedCorners: number;
  angledCorners: number;
  cutoutCount: number;
  estimatedSlabs: number;
  cornerAngles: Array<{ index: number; angleDeg: number; isInside: boolean; isAngled: boolean }>;
}

export interface QuoteLineItem {
  label: string;
  detail: string;
  amount: number;
}

export interface QuoteBreakdown {
  metrics: GeometryMetrics;
  lines: QuoteLineItem[];
  minimumApplied: boolean;
  totalPrice: number;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatInches(inches: number): string {
  const rounded = Math.round(inches * 10) / 10;
  return `${rounded}"`;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export function createRectangleDesign(width = 72, depth = 25.5, isIsland = false): CounterDesign {
  const w = Math.max(12, width);
  const d = Math.max(12, depth);
  return {
    points: [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: d },
      { x: 0, y: d },
    ],
    edges: [
      { kind: isIsland ? 'finished' : 'wall', backsplash: !isIsland },
      { kind: 'finished', backsplash: false },
      { kind: 'finished', backsplash: false },
      { kind: 'finished', backsplash: false },
    ],
    cutouts: [],
  };
}

export function createLShapeDesign(
  topWidth = 108,
  topDepth = 25.5,
  leftLength = 78,
  leftDepth = 25.5,
  angleDeg = 90,
): CounterDesign {
  const tw = Math.max(36, topWidth);
  const td = Math.max(12, topDepth);
  const ll = Math.max(36, leftLength);
  const ld = Math.max(12, leftDepth);
  const clampedAngle = Math.min(135, Math.max(45, angleDeg));
  const theta = (clampedAngle * Math.PI) / 180;
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);
  // Inward perpendicular vector pointing right when angle is 90 deg.
  const nx = Math.sin(theta);
  const ny = -Math.cos(theta);

  const p0: Point = { x: 0, y: 0 };
  const p1: Point = { x: tw, y: 0 };
  const p2: Point = { x: tw, y: td };
  const p5: Point = { x: round2(ll * ux), y: round2(ll * uy) };
  const p4: Point = { x: round2(p5.x + ld * nx), y: round2(p5.y + ld * ny) };

  // Inside corner p3: intersection of y = td and line through p4 in direction -u.
  const t = Math.abs(uy) > 1e-4 ? (p4.y - td) / uy : 0;
  const p3: Point = { x: round2(p4.x - t * ux), y: round2(td) };

  return {
    points: [p0, p1, p2, p3, p4, p5],
    edges: [
      { kind: 'wall', backsplash: true },
      { kind: 'finished', backsplash: false },
      { kind: 'finished', backsplash: false },
      { kind: 'finished', backsplash: false },
      { kind: 'finished', backsplash: false },
      { kind: 'wall', backsplash: true },
    ],
    cutouts: [],
  };
}

export function createUShapeDesign(
  backWidth = 108,
  leftLength = 72,
  rightLength = 72,
  depth = 25.5,
): CounterDesign {
  const bw = Math.max(60, backWidth);
  const d = Math.max(12, depth);
  const ll = Math.max(d + 18, leftLength);
  const rl = Math.max(d + 18, rightLength);

  return {
    points: [
      { x: 0, y: 0 },
      { x: bw, y: 0 },
      { x: bw, y: rl },
      { x: bw - d, y: rl },
      { x: bw - d, y: d },
      { x: d, y: d },
      { x: d, y: ll },
      { x: 0, y: ll },
    ],
    edges: [
      { kind: 'wall', backsplash: true },
      { kind: 'wall', backsplash: true },
      { kind: 'finished', backsplash: false },
      { kind: 'finished', backsplash: false },
      { kind: 'finished', backsplash: false },
      { kind: 'finished', backsplash: false },
      { kind: 'finished', backsplash: false },
      { kind: 'wall', backsplash: true },
    ],
    cutouts: [],
  };
}

export function createDefaultDesignForShape(shape: ShapeType | string): CounterDesign {
  switch (shape) {
    case 'l-shape':
      return createLShapeDesign();
    case 'u-shape':
      return createUShapeDesign();
    default:
      return createRectangleDesign();
  }
}

export function parseDesignJson(designJson?: string): CounterDesign {
  if (!designJson) return createRectangleDesign();
  try {
    const parsed = JSON.parse(designJson) as Partial<CounterDesign>;
    const points = Array.isArray(parsed.points) ? parsed.points : [];
    const edges: CounterEdge[] = points.map((_, i) => {
      const e = parsed.edges?.[i];
      return {
        kind: e?.kind === 'wall' ? 'wall' : 'finished',
        backsplash: Boolean(e?.backsplash),
      };
    });
    const cutouts = Array.isArray(parsed.cutouts) ? parsed.cutouts : [];
    if (points.length < 3) return createRectangleDesign();
    return { points, edges, cutouts };
  } catch {
    return createRectangleDesign();
  }
}

export function computeGeometryMetrics(design: CounterDesign): GeometryMetrics {
  const pts = design.points;
  const n = pts.length;
  if (n < 3) {
    return {
      areaSqFt: 0,
      finishedEdgeLinFt: 0,
      backsplashLinFt: 0,
      insideCorners: 0,
      outsideFinishedCorners: 0,
      angledCorners: 0,
      cutoutCount: design.cutouts.length,
      estimatedSlabs: 0,
      cornerAngles: [],
    };
  }

  let signedArea2 = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    signedArea2 += a.x * b.y - b.x * a.y;
  }

  const areaSqIn = Math.abs(signedArea2) / 2;
  const areaSqFt = round2(areaSqIn / 144);
  const orientationSign = signedArea2 >= 0 ? 1 : -1;

  let finishedInches = 0;
  let backsplashInches = 0;

  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const edge = design.edges[i] ?? { kind: 'finished', backsplash: false };
    if (edge.kind === 'finished') {
      finishedInches += len;
    } else if (edge.kind === 'wall' && edge.backsplash) {
      backsplashInches += len;
    }
  }

  let insideCorners = 0;
  let outsideFinishedCorners = 0;
  let angledCorners = 0;
  const cornerAngles: GeometryMetrics['cornerAngles'] = [];

  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];

    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;

    if (Math.hypot(v1x, v1y) < 1e-4 || Math.hypot(v2x, v2y) < 1e-4) continue;

    const cross = v1x * v2y - v1y * v2x;
    const dot = v1x * v2x + v1y * v2y;
    const turnAngleDeg = Math.abs((Math.atan2(Math.abs(cross), dot) * 180) / Math.PI);
    if (turnAngleDeg < 5 || turnAngleDeg > 175) continue;

    const orientedCross = cross * orientationSign;
    const isInside = orientedCross < -1e-4;
    const isAngled = Math.abs(turnAngleDeg - 90) > 2;

    if (isInside) {
      insideCorners++;
    } else if (orientedCross > 1e-4) {
      const prevEdge = design.edges[(i - 1 + n) % n] ?? { kind: 'finished', backsplash: false };
      const nextEdge = design.edges[i] ?? { kind: 'finished', backsplash: false };
      if (prevEdge.kind === 'finished' && nextEdge.kind === 'finished') {
        outsideFinishedCorners++;
      }
    }

    if (isAngled) {
      angledCorners++;
    }

    const interiorDeg = isInside ? Math.round(180 + turnAngleDeg) : Math.round(180 - turnAngleDeg);
    cornerAngles.push({ index: i, angleDeg: interiorDeg, isInside, isAngled });
  }

  const estimatedSlabs =
    areaSqFt > 0 ? Math.ceil((areaSqFt * (1 + WASTE_FACTOR)) / USABLE_SQ_FT_PER_SLAB) : 0;

  return {
    areaSqFt,
    finishedEdgeLinFt: round2(finishedInches / 12),
    backsplashLinFt: round2(backsplashInches / 12),
    insideCorners,
    outsideFinishedCorners,
    angledCorners,
    cutoutCount: design.cutouts.length,
    estimatedSlabs,
    cornerAngles,
  };
}

export function calculateQuoteBreakdown(
  job: Pick<
    Job,
    'material' | 'thickness' | 'edgeProfile' | 'cornerFinish' | 'includeTemplating' | 'includeRemoval'
  >,
  design: CounterDesign,
): QuoteBreakdown {
  const metrics = computeGeometryMetrics(design);
  const lines: QuoteLineItem[] = [];

  if (metrics.areaSqFt <= 0) {
    return { metrics, lines, minimumApplied: false, totalPrice: 0 };
  }

  const materialOpt = MATERIALS.find((m) => m.name.toLowerCase() === job.material.toLowerCase()) ?? MATERIALS[0];
  const thicknessOpt = THICKNESSES.find((t) => t.name.toLowerCase() === job.thickness.toLowerCase()) ?? THICKNESSES[1];
  const edgeOpt = EDGE_PROFILES.find((e) => e.name.toLowerCase() === job.edgeProfile.toLowerCase()) ?? EDGE_PROFILES[0];
  const cornerOpt =
    CORNER_FINISHES.find((c) => c.name.toLowerCase() === job.cornerFinish.toLowerCase()) ?? CORNER_FINISHES[0];

  const unitMatRate = materialOpt.ratePerSqFt + thicknessOpt.adderPerSqFt;
  const materialCost = round2(metrics.areaSqFt * unitMatRate);
  lines.push({
    label: `${materialOpt.name} (${thicknessOpt.name})`,
    detail: `${metrics.areaSqFt} sq ft × ${formatCurrency(unitMatRate)}/sq ft`,
    amount: materialCost,
  });

  const wasteCost = round2(materialCost * WASTE_FACTOR);
  lines.push({
    label: 'Slab Waste & Yield (10%)',
    detail: `Est. ${metrics.estimatedSlabs} slab${metrics.estimatedSlabs === 1 ? '' : 's'} needed`,
    amount: wasteCost,
  });

  if (metrics.finishedEdgeLinFt > 0) {
    const edgeCost = round2(metrics.finishedEdgeLinFt * edgeOpt.ratePerLinFt);
    lines.push({
      label: `Edge Profile: ${edgeOpt.name}`,
      detail: `${metrics.finishedEdgeLinFt} lin ft × ${formatCurrency(edgeOpt.ratePerLinFt)}/lin ft`,
      amount: edgeCost,
    });
  }

  if (metrics.insideCorners > 0) {
    lines.push({
      label: 'Inside Corner Fabrication',
      detail: `${metrics.insideCorners} corner${metrics.insideCorners === 1 ? '' : 's'} × ${formatCurrency(INSIDE_CORNER_PRICE)}`,
      amount: metrics.insideCorners * INSIDE_CORNER_PRICE,
    });
  }

  if (metrics.outsideFinishedCorners > 0 && cornerOpt.ratePerCorner > 0) {
    lines.push({
      label: `Outside Corners (${cornerOpt.name})`,
      detail: `${metrics.outsideFinishedCorners} corner${metrics.outsideFinishedCorners === 1 ? '' : 's'} × ${formatCurrency(cornerOpt.ratePerCorner)}`,
      amount: metrics.outsideFinishedCorners * cornerOpt.ratePerCorner,
    });
  }

  if (metrics.angledCorners > 0) {
    lines.push({
      label: 'Non-90° Angled Cuts',
      detail: `${metrics.angledCorners} angled corner${metrics.angledCorners === 1 ? '' : 's'} × ${formatCurrency(ANGLED_CORNER_PRICE)}`,
      amount: metrics.angledCorners * ANGLED_CORNER_PRICE,
    });
  }

  if (metrics.backsplashLinFt > 0) {
    const bsCost = round2(metrics.backsplashLinFt * BACKSPLASH_RATE_PER_LIN_FT);
    lines.push({
      label: '4" Matching Backsplash',
      detail: `${metrics.backsplashLinFt} lin ft × ${formatCurrency(BACKSPLASH_RATE_PER_LIN_FT)}/lin ft`,
      amount: bsCost,
    });
  }

  if (design.cutouts.length > 0) {
    const counts = new Map<CutoutType, number>();
    for (const c of design.cutouts) {
      counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
    }
    for (const [type, count] of counts.entries()) {
      const cat = CUTOUT_CATALOG[type] ?? { label: type, price: 150 };
      lines.push({
        label: `Cutout: ${cat.label}`,
        detail: `${count} × ${formatCurrency(cat.price)}`,
        amount: count * cat.price,
      });
    }
  }

  if (job.includeTemplating) {
    lines.push({
      label: 'Laser Templating & Install',
      detail: 'Site measure, delivery & seam set',
      amount: TEMPLATING_FLAT_FEE,
    });
  }

  if (job.includeRemoval) {
    const removalCost = round2(metrics.areaSqFt * REMOVAL_RATE_PER_SQ_FT);
    lines.push({
      label: 'Old Counter Tear-Out & Disposal',
      detail: `${metrics.areaSqFt} sq ft × ${formatCurrency(REMOVAL_RATE_PER_SQ_FT)}/sq ft`,
      amount: removalCost,
    });
  }

  const subtotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const minimumApplied = subtotal < MINIMUM_JOB_CHARGE;
  const totalPrice = minimumApplied ? MINIMUM_JOB_CHARGE : subtotal;

  if (minimumApplied) {
    lines.push({
      label: 'Shop Minimum Adjustment',
      detail: `Minimum job charge of ${formatCurrency(MINIMUM_JOB_CHARGE)}`,
      amount: round2(MINIMUM_JOB_CHARGE - subtotal),
    });
  }

  return { metrics, lines, minimumApplied, totalPrice };
}
