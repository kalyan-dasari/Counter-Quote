import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CUTOUT_CATALOG, type GeometryMetrics, MATERIALS, formatInches, round2 } from '../quote';
import type { CounterDesign, Cutout, CutoutType, EdgeKind, Point } from '../types';

interface CounterCanvasProps {
  design: CounterDesign;
  material: string;
  metrics: GeometryMetrics;
  isDrawingCustom: boolean;
  onDesignChange: (next: CounterDesign, convertedToCustom?: boolean) => void;
  onFinishCustomDraw: () => void;
  onCancelCustomDraw: () => void;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

type DragState =
  | { kind: 'vertex'; index: number }
  | { kind: 'cutout'; id: string; offsetX: number; offsetY: number }
  | { kind: 'pan'; startClientX: number; startClientY: number; startViewBox: ViewBox }
  | null;

function computeBoundsViewBox(points: Point[]): ViewBox {
  if (points.length === 0) {
    return { x: -20, y: -20, w: 160, h: 110 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const spanX = Math.max(48, maxX - minX);
  const spanY = Math.max(36, maxY - minY);
  const pad = Math.max(18, Math.round(Math.max(spanX, spanY) * 0.22));
  return {
    x: minX - pad,
    y: minY - pad,
    w: spanX + pad * 2,
    h: spanY + pad * 2,
  };
}

function polygonCentroid(points: Point[]): Point {
  if (points.length === 0) return { x: 36, y: 12 };
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

function computePolygonOrientation(points: Point[]): number {
  let area2 = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area2 += a.x * b.y - b.x * a.y;
  }
  return area2 >= 0 ? 1 : -1;
}

export function CounterCanvas({
  design,
  material,
  metrics,
  isDrawingCustom,
  onDesignChange,
  onFinishCustomDraw,
  onCancelCustomDraw,
}: CounterCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [viewBox, setViewBox] = useState<ViewBox>(() => computeBoundsViewBox(design.points));
  const [snapInches, setSnapInches] = useState<number>(1);
  const [selectedEdgeIndex, setSelectedEdgeIndex] = useState<number | null>(null);
  const [selectedVertexIndex, setSelectedVertexIndex] = useState<number | null>(null);
  const [selectedCutoutId, setSelectedCutoutId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState>(null);

  // Custom polygon drawing state
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);

  // Reset draft points when entering custom draw mode
  useEffect(() => {
    if (isDrawingCustom) {
      setDraftPoints([]);
      setHoverPoint(null);
      setSelectedEdgeIndex(null);
      setSelectedVertexIndex(null);
      setSelectedCutoutId(null);
      setViewBox({ x: -16, y: -16, w: 168, h: 116 });
    }
  }, [isDrawingCustom]);

  // Fit view when point count changes via preset switch (and not actively dragging)
  const fitView = useCallback(() => {
    setViewBox(computeBoundsViewBox(design.points));
  }, [design.points]);

  const designPointsKey = design.points.length;
  useEffect(() => {
    if (!isDrawingCustom && !dragState) {
      setViewBox(computeBoundsViewBox(design.points));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designPointsKey, isDrawingCustom]);

  const toSvgCoords = useCallback(
    (clientX: number, clientY: number): Point => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const ctm = svg.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const transformed = pt.matrixTransform(ctm.inverse());
      return { x: transformed.x, y: transformed.y };
    },
    [],
  );

  const snapPoint = useCallback(
    (p: Point, reference?: Point): Point => {
      let x = Math.round(p.x / snapInches) * snapInches;
      let y = Math.round(p.y / snapInches) * snapInches;
      if (reference) {
        if (Math.abs(x - reference.x) <= 2) x = reference.x;
        if (Math.abs(y - reference.y) <= 2) y = reference.y;
      }
      return { x: round2(x), y: round2(y) };
    },
    [snapInches],
  );

  const handlePointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (isDrawingCustom) {
      const raw = toSvgCoords(e.clientX, e.clientY);
      const last = draftPoints[draftPoints.length - 1];
      setHoverPoint(snapPoint(raw, last));
      return;
    }

    if (!dragState) return;

    if (dragState.kind === 'pan') {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const scaleX = dragState.startViewBox.w / Math.max(1, rect.width);
      const scaleY = dragState.startViewBox.h / Math.max(1, rect.height);
      const dx = (e.clientX - dragState.startClientX) * scaleX;
      const dy = (e.clientY - dragState.startClientY) * scaleY;
      setViewBox({
        ...dragState.startViewBox,
        x: dragState.startViewBox.x - dx,
        y: dragState.startViewBox.y - dy,
      });
      return;
    }

    const raw = toSvgCoords(e.clientX, e.clientY);

    if (dragState.kind === 'vertex') {
      const snapped = snapPoint(raw);
      const nextPoints = design.points.map((pt, idx) => (idx === dragState.index ? snapped : pt));
      onDesignChange({ ...design, points: nextPoints }, true);
    } else if (dragState.kind === 'cutout') {
      const nextX = round2(Math.round((raw.x - dragState.offsetX) * 2) / 2);
      const nextY = round2(Math.round((raw.y - dragState.offsetY) * 2) / 2);
      const nextCutouts = design.cutouts.map((c) =>
        c.id === dragState.id ? { ...c, x: nextX, y: nextY } : c,
      );
      onDesignChange({ ...design, cutouts: nextCutouts });
    }
  };

  const handlePointerUp = () => {
    setDragState(null);
  };

  const commitDraftPolygon = useCallback(
    (pts: Point[]) => {
      if (pts.length < 3) return;
      // Default top-most / left-most horizontal/vertical edges? Let's make all edges finished initially,
      // except any edge along the minimum Y or X if user wants, or all finished so user clicks wall edges.
      // Actually making edge 0 wall+backsplash if it's the top edge feels intuitive, or all finished + prompt!
      // Let's make all edges 'finished' so perimeter pricing is immediate, and user can click any edge to set Wall + Backsplash.
      const edges = pts.map(() => ({ kind: 'finished' as const, backsplash: false }));
      onDesignChange({ points: pts, edges, cutouts: [] }, true);
      setDraftPoints([]);
      setHoverPoint(null);
      onFinishCustomDraw();
    },
    [onDesignChange, onFinishCustomDraw],
  );

  const handleSvgPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (isDrawingCustom) {
      if (e.button !== 0) return;
      const raw = toSvgCoords(e.clientX, e.clientY);
      const last = draftPoints[draftPoints.length - 1];
      const pt = snapPoint(raw, last);

      // Check if clicking close to the start point to close polygon
      if (draftPoints.length >= 3) {
        const first = draftPoints[0];
        if (Math.hypot(pt.x - first.x, pt.y - first.y) <= 4) {
          commitDraftPolygon(draftPoints);
          return;
        }
      }

      // Avoid zero-length duplicate points
      if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 1) {
        return;
      }

      setDraftPoints([...draftPoints, pt]);
      return;
    }

    // Clicking empty background deselects or starts pan if middle/alt
    if (e.target === svgRef.current || (e.target as Element).getAttribute('data-bg') === 'true') {
      setSelectedEdgeIndex(null);
      setSelectedVertexIndex(null);
      setSelectedCutoutId(null);
      setDragState({
        kind: 'pan',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startViewBox: viewBox,
      });
    }
  };

  const zoom = (factor: number) => {
    setViewBox((vb) => {
      const nw = Math.max(36, Math.min(480, vb.w * factor));
      const nh = Math.max(24, Math.min(360, vb.h * factor));
      return {
        x: vb.x + (vb.w - nw) / 2,
        y: vb.y + (vb.h - nh) / 2,
        w: nw,
        h: nh,
      };
    });
  };

  const addCutout = (type: CutoutType) => {
    const spec = CUTOUT_CATALOG[type];
    const center = polygonCentroid(design.points);
    const offset = (design.cutouts.length % 4) * 4;
    const cutout: Cutout = {
      id: `cut_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      x: round2(center.x + offset - 2),
      y: round2(center.y),
      width: spec.defaultWidth,
      height: spec.defaultHeight,
      rotation: 0,
    };
    onDesignChange({ ...design, cutouts: [...design.cutouts, cutout] });
    setSelectedCutoutId(cutout.id);
    setSelectedEdgeIndex(null);
    setSelectedVertexIndex(null);
  };

  const toggleEdgeKind = (idx: number) => {
    const nextEdges = design.edges.map((edge, i) => {
      if (i !== idx) return edge;
      const nextKind: EdgeKind = edge.kind === 'finished' ? 'wall' : 'finished';
      return { kind: nextKind, backsplash: nextKind === 'wall' ? true : false };
    });
    onDesignChange({ ...design, edges: nextEdges });
  };

  const toggleEdgeBacksplash = (idx: number) => {
    const nextEdges = design.edges.map((edge, i) =>
      i === idx && edge.kind === 'wall' ? { ...edge, backsplash: !edge.backsplash } : edge,
    );
    onDesignChange({ ...design, edges: nextEdges });
  };

  const splitEdge = (idx: number) => {
    const a = design.points[idx];
    const b = design.points[(idx + 1) % design.points.length];
    const mid: Point = { x: round2((a.x + b.x) / 2), y: round2((a.y + b.y) / 2) };
    const nextPoints = [...design.points];
    nextPoints.splice(idx + 1, 0, mid);
    const nextEdges = [...design.edges];
    const edgeCopy = { ...design.edges[idx] };
    nextEdges.splice(idx + 1, 0, edgeCopy);
    onDesignChange({ ...design, points: nextPoints, edges: nextEdges }, true);
    setSelectedVertexIndex(idx + 1);
    setSelectedEdgeIndex(null);
  };

  const addBumpoutOnEdge = (idx: number) => {
    const n = design.points.length;
    const a = design.points[idx];
    const b = design.points[(idx + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 12) return;

    const orient = computePolygonOrientation(design.points);
    // Outward unit normal in SVG coords (+y down):
    // For clockwise (orient = +1), edge tangent (dx, dy) has outward normal (dy, -dx)/len.
    const nx = (orient * dy) / len;
    const ny = (-orient * dx) / len;
    const depth = 6; // 6" outward bumpout

    const p1: Point = { x: round2(a.x + dx * 0.3), y: round2(a.y + dy * 0.3) };
    const p2: Point = { x: round2(p1.x + nx * depth), y: round2(p1.y + ny * depth) };
    const p4: Point = { x: round2(a.x + dx * 0.7), y: round2(a.y + dy * 0.7) };
    const p3: Point = { x: round2(p4.x + nx * depth), y: round2(p4.y + ny * depth) };

    const nextPoints = [...design.points];
    nextPoints.splice(idx + 1, 0, p1, p2, p3, p4);

    const baseEdge = design.edges[idx];
    const nextEdges = [...design.edges];
    nextEdges.splice(
      idx + 1,
      0,
      { ...baseEdge },
      { ...baseEdge },
      { ...baseEdge },
      { ...baseEdge },
    );

    onDesignChange({ ...design, points: nextPoints, edges: nextEdges }, true);
    setSelectedEdgeIndex(null);
  };

  const removeVertex = (idx: number) => {
    if (design.points.length <= 3) return;
    const nextPoints = design.points.filter((_, i) => i !== idx);
    const nextEdges = design.edges.filter((_, i) => i !== idx);
    onDesignChange({ ...design, points: nextPoints, edges: nextEdges }, true);
    setSelectedVertexIndex(null);
  };

  const rotateCutout = (id: string) => {
    const nextCutouts = design.cutouts.map((c) =>
      c.id === id ? { ...c, rotation: (c.rotation + 90) % 180 } : c,
    );
    onDesignChange({ ...design, cutouts: nextCutouts });
  };

  const removeCutout = (id: string) => {
    onDesignChange({ ...design, cutouts: design.cutouts.filter((c) => c.id !== id) });
    setSelectedCutoutId(null);
  };

  const materialSwatch = useMemo(
    () => MATERIALS.find((m) => m.name.toLowerCase() === material.toLowerCase())?.swatch ?? '#c8c3ba',
    [material],
  );

  const orientSign = useMemo(() => computePolygonOrientation(design.points), [design.points]);

  const polygonPointsAttr = useMemo(
    () => design.points.map((p) => `${p.x},${p.y}`).join(' '),
    [design.points],
  );

  // Grid bounds based on current viewBox
  const gridLines = useMemo(() => {
    const minorStep = 6;
    const majorStep = 12;
    const startX = Math.floor(viewBox.x / minorStep) * minorStep;
    const endX = Math.ceil((viewBox.x + viewBox.w) / minorStep) * minorStep;
    const startY = Math.floor(viewBox.y / minorStep) * minorStep;
    const endY = Math.ceil((viewBox.y + viewBox.h) / minorStep) * minorStep;

    const verticals: Array<{ pos: number; major: boolean }> = [];
    for (let x = startX; x <= endX; x += minorStep) {
      verticals.push({ pos: x, major: x % majorStep === 0 });
    }
    const horizontals: Array<{ pos: number; major: boolean }> = [];
    for (let y = startY; y <= endY; y += minorStep) {
      horizontals.push({ pos: y, major: y % majorStep === 0 });
    }
    return { verticals, horizontals, startX, endX, startY, endY };
  }, [viewBox]);

  const selectedEdge = selectedEdgeIndex !== null ? design.edges[selectedEdgeIndex] : null;
  const selectedCutout = selectedCutoutId ? design.cutouts.find((c) => c.id === selectedCutoutId) ?? null : null;

  return (
    <div className="canvas-shell">
      <div className="canvas-toolbar">
        {!isDrawingCustom ? (
          <>
            <div className="toolbar-group">
              <span className="toolbar-label">Cutouts:</span>
              {(Object.keys(CUTOUT_CATALOG) as CutoutType[]).map((type) => {
                const item = CUTOUT_CATALOG[type];
                return (
                  <button
                    key={type}
                    type="button"
                    className="btn-chip"
                    onClick={() => addCutout(type)}
                    title={`Add ${item.label} ($${item.price})`}
                  >
                    + {item.shortLabel}
                  </button>
                );
              })}
            </div>
            <div className="toolbar-group">
              <label className="snap-select">
                Snap:
                <select value={snapInches} onChange={(e) => setSnapInches(Number(e.target.value))}>
                  <option value={0.5}>0.5"</option>
                  <option value={1}>1"</option>
                  <option value={3}>3"</option>
                  <option value={6}>6"</option>
                </select>
              </label>
              <button type="button" className="btn-icon" onClick={() => zoom(0.8)} title="Zoom in">
                +
              </button>
              <button type="button" className="btn-icon" onClick={() => zoom(1.25)} title="Zoom out">
                −
              </button>
              <button type="button" className="btn-icon" onClick={fitView} title="Fit drawing">
                Fit
              </button>
            </div>
          </>
        ) : (
          <div className="toolbar-group draw-banner">
            <span>
              <strong>Custom Draw Mode:</strong> Click grid points to trace your countertop ({draftPoints.length}{' '}
              pts). Click the green starting point or press Finish when ≥ 3 points.
            </span>
            <div className="toolbar-group">
              <button
                type="button"
                className="btn-chip"
                onClick={() => setDraftPoints((pts) => pts.slice(0, -1))}
                disabled={draftPoints.length === 0}
              >
                Undo point
              </button>
              <button
                type="button"
                className="button btn-sm"
                onClick={() => commitDraftPolygon(draftPoints)}
                disabled={draftPoints.length < 3}
              >
                Finish shape
              </button>
              <button type="button" className="btn-chip" onClick={onCancelCustomDraw}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="svg-frame">
        <svg
          ref={svgRef}
          className={`counter-svg ${isDrawingCustom ? 'drawing' : ''}`}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          onPointerDown={handleSvgPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          <defs>
            <pattern id="stone-granite" width="12" height="12" patternUnits="userSpaceOnUse">
              <rect width="12" height="12" fill={materialSwatch} />
              <circle cx="2" cy="3" r="0.6" fill="#3f3a34" opacity="0.35" />
              <circle cx="7" cy="2" r="0.45" fill="#f5f3ef" opacity="0.45" />
              <circle cx="10" cy="8" r="0.7" fill="#4f4840" opacity="0.3" />
              <circle cx="4" cy="9" r="0.5" fill="#2c2824" opacity="0.25" />
            </pattern>
            <pattern id="stone-quartz" width="16" height="16" patternUnits="userSpaceOnUse">
              <rect width="16" height="16" fill={materialSwatch} />
              <circle cx="4" cy="5" r="0.35" fill="#9ca3af" opacity="0.35" />
              <circle cx="12" cy="11" r="0.35" fill="#ffffff" opacity="0.5" />
            </pattern>
            <pattern id="stone-marble" width="24" height="24" patternUnits="userSpaceOnUse">
              <rect width="24" height="24" fill={materialSwatch} />
              <path d="M0 14 Q8 8 16 14 T24 10" fill="none" stroke="#a8a29e" strokeWidth="0.45" opacity="0.45" />
              <path d="M0 4 Q10 10 24 2" fill="none" stroke="#b8b2aa" strokeWidth="0.3" opacity="0.35" />
            </pattern>
          </defs>

          {/* Background hit rect */}
          <rect
            data-bg="true"
            x={gridLines.startX}
            y={gridLines.startY}
            width={gridLines.endX - gridLines.startX}
            height={gridLines.endY - gridLines.startY}
            fill="#fafbfd"
          />

          {/* Blueprint Grid */}
          <g pointerEvents="none">
            {gridLines.verticals.map((v) => (
              <line
                key={`vx_${v.pos}`}
                x1={v.pos}
                y1={gridLines.startY}
                x2={v.pos}
                y2={gridLines.endY}
                stroke={v.major ? '#dde3ec' : '#eef2f6'}
                strokeWidth={v.major ? 0.3 : 0.15}
              />
            ))}
            {gridLines.horizontals.map((h) => (
              <line
                key={`hy_${h.pos}`}
                x1={gridLines.startX}
                y1={h.pos}
                x2={gridLines.endX}
                y2={h.pos}
                stroke={h.major ? '#dde3ec' : '#eef2f6'}
                strokeWidth={h.major ? 0.3 : 0.15}
              />
            ))}
          </g>

          {!isDrawingCustom && design.points.length >= 3 && (
            <>
              {/* Countertop Slab Polygon */}
              <polygon
                points={polygonPointsAttr}
                fill={
                  material.toLowerCase() === 'marble' || material.toLowerCase() === 'quartzite'
                    ? 'url(#stone-marble)'
                    : material.toLowerCase() === 'quartz'
                      ? 'url(#stone-quartz)'
                      : 'url(#stone-granite)'
                }
                stroke="#475569"
                strokeWidth={0.4}
                opacity={0.95}
                pointerEvents="none"
              />

              {/* Backsplash Strips & Interactive Edges */}
              {design.points.map((a, idx) => {
                const b = design.points[(idx + 1) % design.points.length];
                const edge = design.edges[idx] ?? { kind: 'finished', backsplash: false };
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const len = Math.hypot(dx, dy);
                if (len < 0.1) return null;

                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                // Outward normal for label & backsplash placement
                const nx = (orientSign * dy) / len;
                const ny = (-orientSign * dx) / len;
                const isSelected = selectedEdgeIndex === idx;
                const isWall = edge.kind === 'wall';

                return (
                  <g key={`edge_${idx}`}>
                    {/* 4" Backsplash visual strip along wall */}
                    {isWall && edge.backsplash && (
                      <line
                        x1={a.x - nx * 1.1}
                        y1={a.y - ny * 1.1}
                        x2={b.x - nx * 1.1}
                        y2={b.y - ny * 1.1}
                        stroke="#64748b"
                        strokeWidth={2.0}
                        opacity={0.55}
                        pointerEvents="none"
                      />
                    )}

                    {/* Visible Edge Stroke */}
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={isSelected ? '#d97706' : isWall ? '#334155' : '#1d5fa8'}
                      strokeWidth={isSelected ? 1.8 : 1.1}
                      strokeDasharray={isWall ? '2.5 1.5' : undefined}
                      strokeLinecap="round"
                      pointerEvents="none"
                    />

                    {/* Wide Invisible Click Hit Target */}
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="transparent"
                      strokeWidth={6}
                      style={{ cursor: 'pointer' }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setSelectedEdgeIndex(idx);
                        setSelectedVertexIndex(null);
                        setSelectedCutoutId(null);
                      }}
                    />

                    {/* Dimension Label outside the edge */}
                    <g
                      transform={`translate(${mx + nx * 5.2}, ${my + ny * 5.2})`}
                      style={{ cursor: 'pointer' }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setSelectedEdgeIndex(idx);
                        setSelectedVertexIndex(null);
                        setSelectedCutoutId(null);
                      }}
                    >
                      <rect
                        x={-6.5}
                        y={-2.4}
                        width={13}
                        height={4.8}
                        rx={1}
                        fill={isSelected ? '#fef3c7' : '#ffffff'}
                        stroke={isSelected ? '#d97706' : '#cbd5e1'}
                        strokeWidth={0.3}
                      />
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={2.8}
                        fontWeight={600}
                        fill={isSelected ? '#92400e' : '#1e293b'}
                      >
                        {formatInches(len)}
                      </text>
                    </g>
                  </g>
                );
              })}

              {/* Cutouts */}
              {design.cutouts.map((cutout) => {
                const isSel = selectedCutoutId === cutout.id;
                const isFaucet = cutout.type === 'faucet';
                return (
                  <g
                    key={cutout.id}
                    transform={`translate(${cutout.x}, ${cutout.y}) rotate(${cutout.rotation})`}
                    style={{ cursor: 'grab' }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      const raw = toSvgCoords(e.clientX, e.clientY);
                      setSelectedCutoutId(cutout.id);
                      setSelectedEdgeIndex(null);
                      setSelectedVertexIndex(null);
                      setDragState({
                        kind: 'cutout',
                        id: cutout.id,
                        offsetX: raw.x - cutout.x,
                        offsetY: raw.y - cutout.y,
                      });
                    }}
                  >
                    {isFaucet ? (
                      <>
                        <circle
                          cx={0}
                          cy={0}
                          r={1.6}
                          fill="#f8fafc"
                          stroke={isSel ? '#d97706' : '#334155'}
                          strokeWidth={0.5}
                        />
                        <circle cx={0} cy={0} r={0.5} fill="#64748b" />
                      </>
                    ) : (
                      <>
                        <rect
                          x={-cutout.width / 2}
                          y={-cutout.height / 2}
                          width={cutout.width}
                          height={cutout.height}
                          rx={cutout.type === 'undermount_sink' ? 2 : 0.8}
                          fill={cutout.type === 'cooktop' ? '#1e293b' : '#e2e8f0'}
                          stroke={isSel ? '#d97706' : '#334155'}
                          strokeWidth={isSel ? 0.9 : 0.55}
                          strokeDasharray={cutout.type === 'dropin_sink' ? '1.5 1' : undefined}
                        />
                        {cutout.type === 'cooktop' ? (
                          <>
                            <circle cx={-cutout.width * 0.24} cy={-cutout.height * 0.22} r={3.2} fill="none" stroke="#94a3b8" strokeWidth={0.45} />
                            <circle cx={cutout.width * 0.24} cy={-cutout.height * 0.22} r={2.6} fill="none" stroke="#94a3b8" strokeWidth={0.45} />
                            <circle cx={-cutout.width * 0.24} cy={cutout.height * 0.22} r={2.6} fill="none" stroke="#94a3b8" strokeWidth={0.45} />
                            <circle cx={cutout.width * 0.24} cy={cutout.height * 0.22} r={3.5} fill="none" stroke="#94a3b8" strokeWidth={0.45} />
                          </>
                        ) : (
                          <>
                            <rect
                              x={-cutout.width / 2 + 1.5}
                              y={-cutout.height / 2 + 1.5}
                              width={cutout.width - 3}
                              height={cutout.height - 3}
                              rx={1.5}
                              fill="#f8fafc"
                              stroke="#94a3b8"
                              strokeWidth={0.35}
                            />
                            <circle cx={0} cy={0} r={1.2} fill="#94a3b8" />
                          </>
                        )}
                        <text
                          textAnchor="middle"
                          y={cutout.height / 2 + 3.2}
                          fontSize={2.4}
                          fontWeight={600}
                          fill="#334155"
                          pointerEvents="none"
                        >
                          {CUTOUT_CATALOG[cutout.type].shortLabel} ({cutout.width}"×{cutout.height}")
                        </text>
                      </>
                    )}
                  </g>
                );
              })}

              {/* Corner Callouts (Inside Corners & Non-90° Angles) */}
              {metrics.cornerAngles.map((ca) => {
                const pt = design.points[ca.index];
                if (!pt || (!ca.isInside && !ca.isAngled)) return null;
                return (
                  <g key={`corner_${ca.index}`} transform={`translate(${pt.x}, ${pt.y - 4.2})`} pointerEvents="none">
                    <rect
                      x={-7}
                      y={-2}
                      width={14}
                      height={3.6}
                      rx={0.8}
                      fill={ca.isInside ? '#fef3c7' : '#e0f2fe'}
                      stroke={ca.isInside ? '#d97706' : '#0284c7'}
                      strokeWidth={0.25}
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={2.1}
                      fontWeight={700}
                      fill={ca.isInside ? '#92400e' : '#0369a1'}
                    >
                      {ca.isInside ? `Inside ${ca.angleDeg}°` : `${ca.angleDeg}°`}
                    </text>
                  </g>
                );
              })}

              {/* Draggable Vertex Handles */}
              {design.points.map((pt, idx) => {
                const isSel = selectedVertexIndex === idx;
                return (
                  <circle
                    key={`v_${idx}`}
                    cx={pt.x}
                    cy={pt.y}
                    r={isSel ? 2.2 : 1.7}
                    fill={isSel ? '#d97706' : '#ffffff'}
                    stroke={isSel ? '#78350f' : '#1d5fa8'}
                    strokeWidth={0.7}
                    style={{ cursor: 'move' }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSelectedVertexIndex(idx);
                      setSelectedEdgeIndex(null);
                      setSelectedCutoutId(null);
                      setDragState({ kind: 'vertex', index: idx });
                    }}
                  />
                );
              })}
            </>
          )}

          {/* Custom Freehand Drawing Overlay */}
          {isDrawingCustom && (
            <g>
              {draftPoints.length > 0 && (
                <polyline
                  points={draftPoints.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="#1d5fa8"
                  strokeWidth={1.1}
                />
              )}
              {draftPoints.length > 0 && hoverPoint && (
                <>
                  <line
                    x1={draftPoints[draftPoints.length - 1].x}
                    y1={draftPoints[draftPoints.length - 1].y}
                    x2={hoverPoint.x}
                    y2={hoverPoint.y}
                    stroke="#2563eb"
                    strokeWidth={0.8}
                    strokeDasharray="2 1.5"
                  />
                  <text
                    x={(draftPoints[draftPoints.length - 1].x + hoverPoint.x) / 2}
                    y={(draftPoints[draftPoints.length - 1].y + hoverPoint.y) / 2 - 2.5}
                    fontSize={3.2}
                    fontWeight={700}
                    fill="#1d4ed8"
                    textAnchor="middle"
                  >
                    {formatInches(
                      Math.hypot(
                        hoverPoint.x - draftPoints[draftPoints.length - 1].x,
                        hoverPoint.y - draftPoints[draftPoints.length - 1].y,
                      ),
                    )}
                  </text>
                </>
              )}
              {draftPoints.map((p, i) => (
                <circle
                  key={`draft_${i}`}
                  cx={p.x}
                  cy={p.y}
                  r={i === 0 && draftPoints.length >= 3 ? 2.6 : 1.5}
                  fill={i === 0 ? '#16a34a' : '#ffffff'}
                  stroke={i === 0 ? '#14532d' : '#1d5fa8'}
                  strokeWidth={0.7}
                />
              ))}
              {hoverPoint && (
                <circle cx={hoverPoint.x} cy={hoverPoint.y} r={1.2} fill="#2563eb" opacity={0.6} />
              )}
            </g>
          )}
        </svg>

        {/* Legend pill */}
        <div className="canvas-legend">
          <span><i className="legend-swatch finished" /> Finished Edge</span>
          <span><i className="legend-swatch wall" /> Wall Edge</span>
          <span><i className="legend-swatch splash" /> 4" Backsplash</span>
          <span className="muted">Tip: Drag corners to resize/angle · Click any edge to toggle wall/finished</span>
        </div>
      </div>

      {/* Contextual Selection Bar */}
      {selectedEdge && selectedEdgeIndex !== null && (
        <div className="selection-bar">
          <div>
            <strong>Edge #{selectedEdgeIndex + 1}</strong>{' '}
            <span className="muted">
              (
              {formatInches(
                Math.hypot(
                  design.points[(selectedEdgeIndex + 1) % design.points.length].x -
                    design.points[selectedEdgeIndex].x,
                  design.points[(selectedEdgeIndex + 1) % design.points.length].y -
                    design.points[selectedEdgeIndex].y,
                ),
              )}
              )
            </span>
          </div>
          <div className="toolbar-group">
            <button
              type="button"
              className={`btn-chip ${selectedEdge.kind === 'finished' ? 'active' : ''}`}
              onClick={() => toggleEdgeKind(selectedEdgeIndex)}
            >
              {selectedEdge.kind === 'finished' ? 'Finished Edge (Click for Wall)' : 'Wall Edge (Click for Finished)'}
            </button>
            {selectedEdge.kind === 'wall' && (
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={selectedEdge.backsplash}
                  onChange={() => toggleEdgeBacksplash(selectedEdgeIndex)}
                />
                4" Backsplash ($22/lin ft)
              </label>
            )}
            <button type="button" className="btn-chip" onClick={() => splitEdge(selectedEdgeIndex)}>
              + Split Edge
            </button>
            <button type="button" className="btn-chip" onClick={() => addBumpoutOnEdge(selectedEdgeIndex)}>
              + 6" Bumpout
            </button>
          </div>
        </div>
      )}

      {selectedVertexIndex !== null && design.points[selectedVertexIndex] && (
        <div className="selection-bar">
          <div>
            <strong>Corner #{selectedVertexIndex + 1}</strong>{' '}
            <span className="muted">
              ({design.points[selectedVertexIndex].x}", {design.points[selectedVertexIndex].y}")
            </span>
          </div>
          <div className="toolbar-group">
            <button
              type="button"
              className="btn-chip danger"
              onClick={() => removeVertex(selectedVertexIndex)}
              disabled={design.points.length <= 3}
            >
              Delete Corner
            </button>
          </div>
        </div>
      )}

      {selectedCutout && (
        <div className="selection-bar">
          <div>
            <strong>{CUTOUT_CATALOG[selectedCutout.type].label}</strong>{' '}
            <span className="muted">
              ({selectedCutout.width}" × {selectedCutout.height}")
            </span>
          </div>
          <div className="toolbar-group">
            {selectedCutout.type !== 'faucet' && (
              <button type="button" className="btn-chip" onClick={() => rotateCutout(selectedCutout.id)}>
                Rotate 90°
              </button>
            )}
            <button
              type="button"
              className="btn-chip danger"
              onClick={() => removeCutout(selectedCutout.id)}
            >
              Remove Cutout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
