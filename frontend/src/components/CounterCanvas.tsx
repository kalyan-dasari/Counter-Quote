import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  CUTOUT_CATALOG,
  type GeometryMetrics,
  MATERIALS,
  createPieceId,
  createRectanglePiece,
  formatInches,
  getPieceBounds,
  round2,
} from '../quote';
import type {
  CounterDesign,
  CounterPiece,
  Cutout,
  CutoutType,
  EdgeKind,
  Point,
  ReferenceLine,
} from '../types';

export type CanvasSelection =
  | { kind: 'piece'; pieceId: string }
  | { kind: 'edge'; pieceId: string; edgeIndex: number }
  | { kind: 'vertex'; pieceId: string; vertexIndex: number }
  | { kind: 'cutout'; cutoutId: string }
  | { kind: 'line'; lineId: string }
  | null;

interface CounterCanvasProps {
  design: CounterDesign;
  material: string;
  metrics: GeometryMetrics;
  isDrawingLines: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onBeginDragHistory: () => void;
  onDesignChange: (
    next: CounterDesign,
    options?: { recordHistory?: boolean; convertedToCustom?: boolean },
  ) => void;
  onStartDrawLines: () => void;
  onFinishDrawLines: () => void;
  onCancelDrawLines: () => void;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type DragState =
  | { kind: 'vertex'; pieceId: string; index: number; startPt: Point; moved: boolean }
  | {
      kind: 'piece-move';
      pieceId: string;
      startPointer: Point;
      origPoints: Point[];
      moved: boolean;
    }
  | {
      kind: 'piece-resize';
      pieceId: string;
      handle: ResizeHandle;
      origBounds: ReturnType<typeof getPieceBounds>;
      origPoints: Point[];
      moved: boolean;
    }
  | {
      kind: 'cutout-move';
      id: string;
      offsetX: number;
      offsetY: number;
      startPointer: Point;
      moved: boolean;
    }
  | {
      kind: 'cutout-resize';
      id: string;
      handle: 'nw' | 'ne' | 'se' | 'sw';
      orig: Cutout;
      moved: boolean;
    }
  | {
      kind: 'line-move';
      id: string;
      startPointer: Point;
      orig: ReferenceLine;
      moved: boolean;
    }
  | {
      kind: 'line-endpoint';
      id: string;
      endpoint: 1 | 2;
      moved: boolean;
    }
  | { kind: 'pan'; startClientX: number; startClientY: number; startViewBox: ViewBox }
  | null;

function computeBoundsViewBox(design: CounterDesign): ViewBox {
  const allPts: Point[] = [];
  for (const piece of design.pieces) {
    allPts.push(...piece.points);
  }
  for (const line of design.lines) {
    allPts.push({ x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 });
  }
  if (allPts.length === 0) {
    return { x: -20, y: -20, w: 160, h: 110 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of allPts) {
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

function computePolygonOrientation(points: Point[]): number {
  let area2 = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area2 += a.x * b.y - b.x * a.y;
  }
  return area2 >= 0 ? 1 : -1;
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

export function CounterCanvas({
  design,
  material,
  metrics,
  isDrawingLines,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onBeginDragHistory,
  onDesignChange,
  onStartDrawLines,
  onFinishDrawLines,
  onCancelDrawLines,
}: CounterCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [viewBox, setViewBox] = useState<ViewBox>(() => computeBoundsViewBox(design));
  const [snapInches, setSnapInches] = useState<number>(1);
  const [selection, setSelection] = useState<CanvasSelection>(null);
  const [dragState, setDragState] = useState<DragState>(null);

  // Line / custom polygon drawing state
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);

  const seedDrawFromPoint = useCallback(
    (startPt?: Point) => {
      setDraftPoints(startPt ? [startPt] : []);
      setHoverPoint(null);
      setSelection(null);
      onStartDrawLines();
    },
    [onStartDrawLines],
  );

  // Clear draft if draw mode toggled externally
  useEffect(() => {
    if (!isDrawingLines) {
      setDraftPoints([]);
      setHoverPoint(null);
    }
  }, [isDrawingLines]);

  // Keep selection valid if undo/redo removes the selected item
  useEffect(() => {
    if (!selection) return;
    if (selection.kind === 'piece' && !design.pieces.some((p) => p.id === selection.pieceId)) {
      setSelection(null);
    } else if (selection.kind === 'cutout' && !design.cutouts.some((c) => c.id === selection.cutoutId)) {
      setSelection(null);
    } else if (selection.kind === 'line' && !design.lines.some((l) => l.id === selection.lineId)) {
      setSelection(null);
    } else if (
      (selection.kind === 'edge' || selection.kind === 'vertex') &&
      !design.pieces.some((p) => p.id === selection.pieceId)
    ) {
      setSelection(null);
    }
  }, [design, selection]);

  const fitView = useCallback(() => {
    setViewBox(computeBoundsViewBox(design));
  }, [design]);

  const pieceCount = design.pieces.length;
  useEffect(() => {
    if (!isDrawingLines && !dragState) {
      setViewBox(computeBoundsViewBox(design));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieceCount]);

  const toSvgCoords = useCallback((clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const transformed = pt.matrixTransform(ctm.inverse());
    return { x: transformed.x, y: transformed.y };
  }, []);

  const snapValue = useCallback(
    (v: number) => round2(Math.round(v / snapInches) * snapInches),
    [snapInches],
  );

  const snapPoint = useCallback(
    (p: Point, reference?: Point): Point => {
      let x = snapValue(p.x);
      let y = snapValue(p.y);
      if (reference) {
        if (Math.abs(x - reference.x) <= 2) x = reference.x;
        if (Math.abs(y - reference.y) <= 2) y = reference.y;
      }
      return { x, y };
    },
    [snapValue],
  );

  const updatePiece = useCallback(
    (pieceId: string, updater: (p: CounterPiece) => CounterPiece, options?: { recordHistory?: boolean; convertedToCustom?: boolean }) => {
      const nextPieces = design.pieces.map((p) => (p.id === pieceId ? updater(p) : p));
      onDesignChange({ ...design, pieces: nextPieces }, options);
    },
    [design, onDesignChange],
  );

  const resizePieceToBounds = useCallback(
    (piece: CounterPiece, newMinX: number, newMinY: number, newW: number, newH: number) => {
      const b = getPieceBounds(piece.points);
      const oldW = Math.max(1, b.width);
      const oldH = Math.max(1, b.height);
      const sx = Math.max(6, newW) / oldW;
      const sy = Math.max(6, newH) / oldH;
      const nextPoints = piece.points.map((pt) => ({
        x: round2(newMinX + (pt.x - b.minX) * sx),
        y: round2(newMinY + (pt.y - b.minY) * sy),
      }));
      return { ...piece, points: nextPoints };
    },
    [],
  );

  const handlePointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (isDrawingLines) {
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
      if (!dragState.moved) {
        if (Math.hypot(snapped.x - dragState.startPt.x, snapped.y - dragState.startPt.y) < 0.25) return;
        onBeginDragHistory();
        dragState.moved = true;
      }
      updatePiece(
        dragState.pieceId,
        (piece) => ({
          ...piece,
          points: piece.points.map((pt, idx) => (idx === dragState.index ? snapped : pt)),
        }),
        { recordHistory: false, convertedToCustom: true },
      );
    } else if (dragState.kind === 'piece-move') {
      const dx = snapValue(raw.x - dragState.startPointer.x);
      const dy = snapValue(raw.y - dragState.startPointer.y);
      if (!dragState.moved) {
        if (Math.hypot(dx, dy) < 0.25) return;
        onBeginDragHistory();
        dragState.moved = true;
      }
      updatePiece(
        dragState.pieceId,
        (piece) => ({
          ...piece,
          points: dragState.origPoints.map((pt) => ({
            x: round2(pt.x + dx),
            y: round2(pt.y + dy),
          })),
        }),
        { recordHistory: false },
      );
    } else if (dragState.kind === 'piece-resize') {
      const snapped = snapPoint(raw);
      const b = dragState.origBounds;
      const h = dragState.handle;
      let minX = b.minX;
      let maxX = b.maxX;
      let minY = b.minY;
      let maxY = b.maxY;

      if (h.includes('e')) maxX = Math.max(b.minX + 6, snapped.x);
      if (h.includes('w')) minX = Math.min(b.maxX - 6, snapped.x);
      if (h.includes('s')) maxY = Math.max(b.minY + 6, snapped.y);
      if (h.includes('n')) minY = Math.min(b.maxY - 6, snapped.y);

      if (!dragState.moved) {
        if (
          Math.abs(minX - b.minX) < 0.25 &&
          Math.abs(maxX - b.maxX) < 0.25 &&
          Math.abs(minY - b.minY) < 0.25 &&
          Math.abs(maxY - b.maxY) < 0.25
        ) {
          return;
        }
        onBeginDragHistory();
        dragState.moved = true;
      }

      const origW = Math.max(1, b.width);
      const origH = Math.max(1, b.height);
      const sx = (maxX - minX) / origW;
      const sy = (maxY - minY) / origH;

      updatePiece(
        dragState.pieceId,
        (piece) => ({
          ...piece,
          points: dragState.origPoints.map((pt) => ({
            x: round2(minX + (pt.x - b.minX) * sx),
            y: round2(minY + (pt.y - b.minY) * sy),
          })),
        }),
        { recordHistory: false, convertedToCustom: true },
      );
    } else if (dragState.kind === 'cutout-move') {
      if (!dragState.moved) {
        if (Math.hypot(raw.x - dragState.startPointer.x, raw.y - dragState.startPointer.y) < 0.25) return;
        onBeginDragHistory();
        dragState.moved = true;
      }
      const nextX = round2(Math.round((raw.x - dragState.offsetX) * 2) / 2);
      const nextY = round2(Math.round((raw.y - dragState.offsetY) * 2) / 2);
      onDesignChange(
        {
          ...design,
          cutouts: design.cutouts.map((c) => (c.id === dragState.id ? { ...c, x: nextX, y: nextY } : c)),
        },
        { recordHistory: false },
      );
    } else if (dragState.kind === 'cutout-resize') {
      const orig = dragState.orig;
      const rad = (orig.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      // Transform pointer into cutout local unrotated coordinates
      const dx = raw.x - orig.x;
      const dy = raw.y - orig.y;
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;

      const minDim = orig.type === 'faucet' ? 1 : 6;
      const halfW = orig.width / 2;
      const halfH = orig.height / 2;

      const anchorX = dragState.handle.includes('e') ? -halfW : halfW;
      const anchorY = dragState.handle.includes('s') ? -halfH : halfH;

      const targetX = dragState.handle.includes('e')
        ? Math.max(anchorX + minDim, Math.round(lx * 2) / 2)
        : Math.min(anchorX - minDim, Math.round(lx * 2) / 2);
      const targetY = dragState.handle.includes('s')
        ? Math.max(anchorY + minDim, Math.round(ly * 2) / 2)
        : Math.min(anchorY - minDim, Math.round(ly * 2) / 2);

      const newW = round2(Math.abs(targetX - anchorX));
      const newH = round2(Math.abs(targetY - anchorY));
      const localCenterX = (anchorX + targetX) / 2;
      const localCenterY = (anchorY + targetY) / 2;

      const worldCenterX = round2(orig.x + localCenterX * cos - localCenterY * sin);
      const worldCenterY = round2(orig.y + localCenterX * sin + localCenterY * cos);

      if (!dragState.moved) {
        if (Math.abs(newW - orig.width) < 0.25 && Math.abs(newH - orig.height) < 0.25) return;
        onBeginDragHistory();
        dragState.moved = true;
      }

      onDesignChange(
        {
          ...design,
          cutouts: design.cutouts.map((c) =>
            c.id === orig.id
              ? { ...c, x: worldCenterX, y: worldCenterY, width: newW, height: newH }
              : c,
          ),
        },
        { recordHistory: false },
      );
    } else if (dragState.kind === 'line-move') {
      const dx = snapValue(raw.x - dragState.startPointer.x);
      const dy = snapValue(raw.y - dragState.startPointer.y);
      if (!dragState.moved) {
        if (Math.hypot(dx, dy) < 0.25) return;
        onBeginDragHistory();
        dragState.moved = true;
      }
      onDesignChange(
        {
          ...design,
          lines: design.lines.map((l) =>
            l.id === dragState.id
              ? {
                  ...l,
                  x1: round2(dragState.orig.x1 + dx),
                  y1: round2(dragState.orig.y1 + dy),
                  x2: round2(dragState.orig.x2 + dx),
                  y2: round2(dragState.orig.y2 + dy),
                }
              : l,
          ),
        },
        { recordHistory: false },
      );
    } else if (dragState.kind === 'line-endpoint') {
      const snapped = snapPoint(raw);
      if (!dragState.moved) {
        onBeginDragHistory();
        dragState.moved = true;
      }
      onDesignChange(
        {
          ...design,
          lines: design.lines.map((l) =>
            l.id === dragState.id
              ? dragState.endpoint === 1
                ? { ...l, x1: snapped.x, y1: snapped.y }
                : { ...l, x2: snapped.x, y2: snapped.y }
              : l,
          ),
        },
        { recordHistory: false },
      );
    }
  };

  const handlePointerUp = () => {
    setDragState(null);
  };

  const commitDrawnAsPiece = useCallback(
    (pts: Point[]) => {
      if (pts.length < 3) return;
      const newPiece: CounterPiece = {
        id: createPieceId(),
        label: `Piece ${design.pieces.length + 1}`,
        points: pts,
        edges: pts.map(() => ({ kind: 'finished' as const, backsplash: false })),
      };
      onDesignChange(
        { ...design, pieces: [...design.pieces, newPiece] },
        { recordHistory: true, convertedToCustom: true },
      );
      setSelection({ kind: 'piece', pieceId: newPiece.id });
      setDraftPoints([]);
      setHoverPoint(null);
      onFinishDrawLines();
    },
    [design, onDesignChange, onFinishDrawLines],
  );

  const commitDrawnAsLine = useCallback(
    (pts: Point[]) => {
      if (pts.length < 2) return;
      const newLines: ReferenceLine[] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        newLines.push({
          id: `line_${Date.now()}_${i}`,
          x1: pts[i].x,
          y1: pts[i].y,
          x2: pts[i + 1].x,
          y2: pts[i + 1].y,
        });
      }
      onDesignChange(
        { ...design, lines: [...design.lines, ...newLines] },
        { recordHistory: true },
      );
      setSelection({ kind: 'line', lineId: newLines[newLines.length - 1].id });
      setDraftPoints([]);
      setHoverPoint(null);
      onFinishDrawLines();
    },
    [design, onDesignChange, onFinishDrawLines],
  );

  const handleSvgPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (isDrawingLines) {
      if (e.button !== 0) return;
      const raw = toSvgCoords(e.clientX, e.clientY);
      const last = draftPoints[draftPoints.length - 1];
      const pt = snapPoint(raw, last);

      if (draftPoints.length >= 3) {
        const first = draftPoints[0];
        if (Math.hypot(pt.x - first.x, pt.y - first.y) <= 4) {
          commitDrawnAsPiece(draftPoints);
          return;
        }
      }

      if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 1) {
        return;
      }

      setDraftPoints([...draftPoints, pt]);
      return;
    }

    if (e.target === svgRef.current || (e.target as Element).getAttribute('data-bg') === 'true') {
      setSelection(null);
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
      const nw = Math.max(36, Math.min(540, vb.w * factor));
      const nh = Math.max(24, Math.min(400, vb.h * factor));
      return {
        x: vb.x + (vb.w - nw) / 2,
        y: vb.y + (vb.h - nh) / 2,
        w: nw,
        h: nh,
      };
    });
  };

  const addCounterPiece = () => {
    // Place new piece cleanly below existing pieces
    let maxY = 0;
    let minX = 0;
    if (design.pieces.length > 0) {
      const b = getPieceBounds(design.pieces.flatMap((p) => p.points));
      maxY = b.maxY + 18;
      minX = b.minX;
    }
    const newPiece = createRectanglePiece(
      60,
      36,
      true,
      minX,
      maxY,
      `Island / Piece ${design.pieces.length + 1}`,
      createPieceId(),
    );
    onDesignChange(
      { ...design, pieces: [...design.pieces, newPiece] },
      { recordHistory: true, convertedToCustom: true },
    );
    setSelection({ kind: 'piece', pieceId: newPiece.id });
  };

  const addCutout = (type: CutoutType, targetPiece?: CounterPiece) => {
    const spec = CUTOUT_CATALOG[type];
    const refPiece = targetPiece ?? design.pieces[0];
    const center = refPiece ? polygonCentroid(refPiece.points) : { x: 36, y: 12 };
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
    onDesignChange({ ...design, cutouts: [...design.cutouts, cutout] }, { recordHistory: true });
    setSelection({ kind: 'cutout', cutoutId: cutout.id });
  };

  const duplicatePiece = (piece: CounterPiece) => {
    const b = getPieceBounds(piece.points);
    const copy: CounterPiece = {
      id: createPieceId(),
      label: `${piece.label} Copy`,
      points: piece.points.map((pt) => ({ x: round2(pt.x + 12), y: round2(pt.y + b.height + 16) })),
      edges: piece.edges.map((e) => ({ ...e })),
    };
    onDesignChange(
      { ...design, pieces: [...design.pieces, copy] },
      { recordHistory: true, convertedToCustom: true },
    );
    setSelection({ kind: 'piece', pieceId: copy.id });
  };

  const rotatePiece90 = (piece: CounterPiece) => {
    const b = getPieceBounds(piece.points);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const rotated = piece.points.map((pt) => ({
      x: round2(cx - (pt.y - cy)),
      y: round2(cy + (pt.x - cx)),
    }));
    updatePiece(piece.id, (p) => ({ ...p, points: rotated }), {
      recordHistory: true,
      convertedToCustom: true,
    });
  };

  const deletePiece = (pieceId: string) => {
    if (design.pieces.length <= 1) return;
    onDesignChange(
      { ...design, pieces: design.pieces.filter((p) => p.id !== pieceId) },
      { recordHistory: true, convertedToCustom: true },
    );
    setSelection(null);
  };

  const toggleEdgeKind = (pieceId: string, idx: number) => {
    updatePiece(
      pieceId,
      (piece) => ({
        ...piece,
        edges: piece.edges.map((edge, i) => {
          if (i !== idx) return edge;
          const nextKind: EdgeKind = edge.kind === 'finished' ? 'wall' : 'finished';
          return { kind: nextKind, backsplash: nextKind === 'wall' };
        }),
      }),
      { recordHistory: true },
    );
  };

  const toggleEdgeBacksplash = (pieceId: string, idx: number) => {
    updatePiece(
      pieceId,
      (piece) => ({
        ...piece,
        edges: piece.edges.map((edge, i) =>
          i === idx && edge.kind === 'wall' ? { ...edge, backsplash: !edge.backsplash } : edge,
        ),
      }),
      { recordHistory: true },
    );
  };

  const setEdgeLength = (pieceId: string, idx: number, targetLen: number) => {
    const piece = design.pieces.find((p) => p.id === pieceId);
    if (!piece || targetLen < 2) return;
    const n = piece.points.length;
    const a = piece.points[idx];
    const b = piece.points[(idx + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) return;
    const scale = targetLen / len;
    const newB: Point = { x: round2(a.x + dx * scale), y: round2(a.y + dy * scale) };
    updatePiece(
      pieceId,
      (p) => ({
        ...p,
        points: p.points.map((pt, i) => (i === (idx + 1) % n ? newB : pt)),
      }),
      { recordHistory: true, convertedToCustom: true },
    );
  };

  const splitEdge = (pieceId: string, idx: number) => {
    const piece = design.pieces.find((p) => p.id === pieceId);
    if (!piece) return;
    const a = piece.points[idx];
    const b = piece.points[(idx + 1) % piece.points.length];
    const mid: Point = { x: round2((a.x + b.x) / 2), y: round2((a.y + b.y) / 2) };
    const nextPoints = [...piece.points];
    nextPoints.splice(idx + 1, 0, mid);
    const nextEdges = [...piece.edges];
    nextEdges.splice(idx + 1, 0, { ...piece.edges[idx] });
    updatePiece(pieceId, (p) => ({ ...p, points: nextPoints, edges: nextEdges }), {
      recordHistory: true,
      convertedToCustom: true,
    });
    setSelection({ kind: 'vertex', pieceId, vertexIndex: idx + 1 });
  };

  const addBumpoutOnEdge = (pieceId: string, idx: number) => {
    const piece = design.pieces.find((p) => p.id === pieceId);
    if (!piece) return;
    const n = piece.points.length;
    const a = piece.points[idx];
    const b = piece.points[(idx + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 12) return;

    const orient = computePolygonOrientation(piece.points);
    const nx = (orient * dy) / len;
    const ny = (-orient * dx) / len;
    const depth = 6;

    const p1: Point = { x: round2(a.x + dx * 0.3), y: round2(a.y + dy * 0.3) };
    const p2: Point = { x: round2(p1.x + nx * depth), y: round2(p1.y + ny * depth) };
    const p4: Point = { x: round2(a.x + dx * 0.7), y: round2(a.y + dy * 0.7) };
    const p3: Point = { x: round2(p4.x + nx * depth), y: round2(p4.y + ny * depth) };

    const nextPoints = [...piece.points];
    nextPoints.splice(idx + 1, 0, p1, p2, p3, p4);

    const baseEdge = piece.edges[idx];
    const nextEdges = [...piece.edges];
    nextEdges.splice(idx + 1, 0, { ...baseEdge }, { ...baseEdge }, { ...baseEdge }, { ...baseEdge });

    updatePiece(pieceId, (p) => ({ ...p, points: nextPoints, edges: nextEdges }), {
      recordHistory: true,
      convertedToCustom: true,
    });
    setSelection({ kind: 'piece', pieceId });
  };

  const removeVertex = (pieceId: string, idx: number) => {
    const piece = design.pieces.find((p) => p.id === pieceId);
    if (!piece || piece.points.length <= 3) return;
    updatePiece(
      pieceId,
      (p) => ({
        ...p,
        points: p.points.filter((_, i) => i !== idx),
        edges: p.edges.filter((_, i) => i !== idx),
      }),
      { recordHistory: true, convertedToCustom: true },
    );
    setSelection({ kind: 'piece', pieceId });
  };

  const updateCutout = (id: string, patch: Partial<Cutout>, recordHistory = true) => {
    onDesignChange(
      {
        ...design,
        cutouts: design.cutouts.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      },
      { recordHistory },
    );
  };

  const removeCutout = (id: string) => {
    onDesignChange(
      { ...design, cutouts: design.cutouts.filter((c) => c.id !== id) },
      { recordHistory: true },
    );
    setSelection(null);
  };

  const removeLine = (id: string) => {
    onDesignChange(
      { ...design, lines: design.lines.filter((l) => l.id !== id) },
      { recordHistory: true },
    );
    setSelection(null);
  };

  const materialSwatch = useMemo(
    () => MATERIALS.find((m) => m.name.toLowerCase() === material.toLowerCase())?.swatch ?? '#c8c3ba',
    [material],
  );

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

  const selectedPiece =
    selection?.kind === 'piece' || selection?.kind === 'edge' || selection?.kind === 'vertex'
      ? design.pieces.find((p) => p.id === selection.pieceId) ?? null
      : null;

  const selectedPieceBounds = selectedPiece ? getPieceBounds(selectedPiece.points) : null;
  const selectedCutout =
    selection?.kind === 'cutout'
      ? design.cutouts.find((c) => c.id === selection.cutoutId) ?? null
      : null;
  const selectedLine =
    selection?.kind === 'line' ? design.lines.find((l) => l.id === selection.lineId) ?? null : null;

  return (
    <div className="canvas-shell">
      <div className="canvas-toolbar">
        {!isDrawingLines ? (
          <>
            <div className="toolbar-group">
              <button
                type="button"
                className="btn-chip"
                onClick={onUndo}
                disabled={!canUndo}
                title="Undo (Ctrl+Z)"
              >
                ↶ Undo
              </button>
              <button
                type="button"
                className="btn-chip"
                onClick={onRedo}
                disabled={!canRedo}
                title="Redo (Ctrl+Y)"
              >
                ↷ Redo
              </button>
              <span className="toolbar-divider" />
              <span className="toolbar-label">Add:</span>
              <button
                type="button"
                className="btn-chip"
                onClick={addCounterPiece}
                title="Add another countertop piece or island"
              >
                + Counter Piece
              </button>
              <button
                type="button"
                className="btn-chip"
                onClick={() => seedDrawFromPoint()}
                title="Draw line segments or a custom shape"
              >
                ✎ Draw Lines
              </button>
              {(Object.keys(CUTOUT_CATALOG) as CutoutType[]).map((type) => {
                const item = CUTOUT_CATALOG[type];
                return (
                  <button
                    key={type}
                    type="button"
                    className="btn-chip"
                    onClick={() => addCutout(type, selectedPiece ?? undefined)}
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
              <strong>Draw Lines Mode:</strong> Click points on the grid ({draftPoints.length} pts). Finish
              as a <strong>Line</strong> (≥ 2 pts) or click green start point / <strong>Close as Counter Piece</strong>{' '}
              (≥ 3 pts).
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
                className="btn-chip"
                onClick={() => commitDrawnAsLine(draftPoints)}
                disabled={draftPoints.length < 2}
              >
                Finish as Line
              </button>
              <button
                type="button"
                className="button btn-sm"
                onClick={() => commitDrawnAsPiece(draftPoints)}
                disabled={draftPoints.length < 3}
              >
                Close as Counter Piece
              </button>
              <button type="button" className="btn-chip" onClick={onCancelDrawLines}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="svg-frame">
        <svg
          ref={svgRef}
          className={`counter-svg ${isDrawingLines ? 'drawing' : ''}`}
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

          {/* Countertop Pieces */}
          {design.pieces.map((piece) => {
            if (piece.points.length < 3) return null;
            const orientSign = computePolygonOrientation(piece.points);
            const bounds = getPieceBounds(piece.points);
            const isPieceSelected = selection?.kind === 'piece' && selection.pieceId === piece.id;
            const polygonAttr = piece.points.map((p) => `${p.x},${p.y}`).join(' ');

            return (
              <g key={piece.id}>
                {/* Clickable Slab Body */}
                <polygon
                  points={polygonAttr}
                  fill={
                    material.toLowerCase() === 'marble' || material.toLowerCase() === 'quartzite'
                      ? 'url(#stone-marble)'
                      : material.toLowerCase() === 'quartz'
                        ? 'url(#stone-quartz)'
                        : 'url(#stone-granite)'
                  }
                  stroke={isPieceSelected ? '#d97706' : '#475569'}
                  strokeWidth={isPieceSelected ? 0.8 : 0.4}
                  opacity={0.95}
                  style={{ cursor: isDrawingLines ? 'crosshair' : 'grab' }}
                  onPointerDown={(e) => {
                    if (isDrawingLines) return;
                    e.stopPropagation();
                    const raw = toSvgCoords(e.clientX, e.clientY);
                    setSelection({ kind: 'piece', pieceId: piece.id });
                    setDragState({
                      kind: 'piece-move',
                      pieceId: piece.id,
                      startPointer: raw,
                      origPoints: piece.points.map((pt) => ({ ...pt })),
                      moved: false,
                    });
                  }}
                />

                {/* Piece label when multiple pieces */}
                {design.pieces.length > 1 && (
                  <text
                    x={(bounds.minX + bounds.maxX) / 2}
                    y={bounds.minY + 5}
                    fontSize={2.8}
                    fontWeight={700}
                    fill="#334155"
                    textAnchor="middle"
                    opacity={0.7}
                    pointerEvents="none"
                  >
                    {piece.label}
                  </text>
                )}

                {/* Edges & Backsplash */}
                {piece.points.map((a, idx) => {
                  const b = piece.points[(idx + 1) % piece.points.length];
                  const edge = piece.edges[idx] ?? { kind: 'finished', backsplash: false };
                  const dx = b.x - a.x;
                  const dy = b.y - a.y;
                  const len = Math.hypot(dx, dy);
                  if (len < 0.1) return null;

                  const mx = (a.x + b.x) / 2;
                  const my = (a.y + b.y) / 2;
                  const nx = (orientSign * dy) / len;
                  const ny = (-orientSign * dx) / len;
                  const isEdgeSelected =
                    selection?.kind === 'edge' &&
                    selection.pieceId === piece.id &&
                    selection.edgeIndex === idx;
                  const isWall = edge.kind === 'wall';

                  return (
                    <g key={`${piece.id}_e_${idx}`}>
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

                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke={isEdgeSelected ? '#d97706' : isWall ? '#334155' : '#1d5fa8'}
                        strokeWidth={isEdgeSelected ? 1.8 : 1.1}
                        strokeDasharray={isWall ? '2.5 1.5' : undefined}
                        strokeLinecap="round"
                        pointerEvents="none"
                      />

                      {!isDrawingLines && (
                        <>
                          <line
                            x1={a.x}
                            y1={a.y}
                            x2={b.x}
                            y2={b.y}
                            stroke="transparent"
                            strokeWidth={5.5}
                            style={{ cursor: 'pointer' }}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              setSelection({ kind: 'edge', pieceId: piece.id, edgeIndex: idx });
                            }}
                          />
                          <g
                            transform={`translate(${mx + nx * 5.2}, ${my + ny * 5.2})`}
                            style={{ cursor: 'pointer' }}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              setSelection({ kind: 'edge', pieceId: piece.id, edgeIndex: idx });
                            }}
                          >
                            <rect
                              x={-6.5}
                              y={-2.4}
                              width={13}
                              height={4.8}
                              rx={1}
                              fill={isEdgeSelected ? '#fef3c7' : '#ffffff'}
                              stroke={isEdgeSelected ? '#d97706' : '#cbd5e1'}
                              strokeWidth={0.3}
                            />
                            <text
                              textAnchor="middle"
                              dominantBaseline="central"
                              fontSize={2.8}
                              fontWeight={600}
                              fill={isEdgeSelected ? '#92400e' : '#1e293b'}
                            >
                              {formatInches(len)}
                            </text>
                          </g>
                        </>
                      )}
                    </g>
                  );
                })}

                {/* Corner Badges */}
                {metrics.cornerAngles
                  .filter((ca) => ca.pieceId === piece.id && (ca.isInside || ca.isAngled))
                  .map((ca) => {
                    const pt = piece.points[ca.index];
                    if (!pt) return null;
                    return (
                      <g
                        key={`${piece.id}_ca_${ca.index}`}
                        transform={`translate(${pt.x}, ${pt.y - 4.2})`}
                        pointerEvents="none"
                      >
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

                {/* Bounding-Box Resize Handles when Piece is Selected */}
                {!isDrawingLines && isPieceSelected && (
                  <g>
                    <rect
                      x={bounds.minX}
                      y={bounds.minY}
                      width={bounds.width}
                      height={bounds.height}
                      fill="none"
                      stroke="#d97706"
                      strokeWidth={0.5}
                      strokeDasharray="2 1.5"
                      pointerEvents="none"
                    />
                    {(
                      [
                        { h: 'nw', x: bounds.minX, y: bounds.minY, cur: 'nwse-resize' },
                        { h: 'n', x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY, cur: 'ns-resize' },
                        { h: 'ne', x: bounds.maxX, y: bounds.minY, cur: 'nesw-resize' },
                        { h: 'e', x: bounds.maxX, y: (bounds.minY + bounds.maxY) / 2, cur: 'ew-resize' },
                        { h: 'se', x: bounds.maxX, y: bounds.maxY, cur: 'nwse-resize' },
                        { h: 's', x: (bounds.minX + bounds.maxX) / 2, y: bounds.maxY, cur: 'ns-resize' },
                        { h: 'sw', x: bounds.minX, y: bounds.maxY, cur: 'nesw-resize' },
                        { h: 'w', x: bounds.minX, y: (bounds.minY + bounds.maxY) / 2, cur: 'ew-resize' },
                      ] as const
                    ).map((item) => (
                      <rect
                        key={`resize_${item.h}`}
                        x={item.x - 1.6}
                        y={item.y - 1.6}
                        width={3.2}
                        height={3.2}
                        fill="#fef3c7"
                        stroke="#d97706"
                        strokeWidth={0.55}
                        style={{ cursor: item.cur }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setDragState({
                            kind: 'piece-resize',
                            pieceId: piece.id,
                            handle: item.h,
                            origBounds: bounds,
                            origPoints: piece.points.map((pt) => ({ ...pt })),
                            moved: false,
                          });
                        }}
                      />
                    ))}
                  </g>
                )}

                {/* Draggable Vertex Handles */}
                {!isDrawingLines &&
                  piece.points.map((pt, idx) => {
                    const isVertexSel =
                      selection?.kind === 'vertex' &&
                      selection.pieceId === piece.id &&
                      selection.vertexIndex === idx;
                    return (
                      <circle
                        key={`${piece.id}_v_${idx}`}
                        cx={pt.x}
                        cy={pt.y}
                        r={isVertexSel ? 2.1 : 1.5}
                        fill={isVertexSel ? '#d97706' : '#ffffff'}
                        stroke={isVertexSel ? '#78350f' : '#1d5fa8'}
                        strokeWidth={0.65}
                        style={{ cursor: 'move' }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setSelection({ kind: 'vertex', pieceId: piece.id, vertexIndex: idx });
                          setDragState({
                            kind: 'vertex',
                            pieceId: piece.id,
                            index: idx,
                            startPt: pt,
                            moved: false,
                          });
                        }}
                      />
                    );
                  })}
              </g>
            );
          })}

          {/* Reference / Seam Lines */}
          {design.lines.map((line) => {
            const isSel = selection?.kind === 'line' && selection.lineId === line.id;
            const len = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
            const mx = (line.x1 + line.x2) / 2;
            const my = (line.y1 + line.y2) / 2;
            return (
              <g key={line.id}>
                <line
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                  stroke={isSel ? '#d97706' : '#0f766e'}
                  strokeWidth={isSel ? 1.4 : 0.9}
                  strokeDasharray="3 1.5"
                  pointerEvents="none"
                />
                {!isDrawingLines && (
                  <line
                    x1={line.x1}
                    y1={line.y1}
                    x2={line.x2}
                    y2={line.y2}
                    stroke="transparent"
                    strokeWidth={5}
                    style={{ cursor: 'grab' }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      const raw = toSvgCoords(e.clientX, e.clientY);
                      setSelection({ kind: 'line', lineId: line.id });
                      setDragState({
                        kind: 'line-move',
                        id: line.id,
                        startPointer: raw,
                        orig: { ...line },
                        moved: false,
                      });
                    }}
                  />
                )}
                <text
                  x={mx}
                  y={my - 2}
                  fontSize={2.6}
                  fontWeight={700}
                  fill={isSel ? '#92400e' : '#0f766e'}
                  textAnchor="middle"
                  pointerEvents="none"
                >
                  {formatInches(len)}
                </text>
                {!isDrawingLines && isSel && (
                  <>
                    <circle
                      cx={line.x1}
                      cy={line.y1}
                      r={1.8}
                      fill="#fef3c7"
                      stroke="#d97706"
                      strokeWidth={0.6}
                      style={{ cursor: 'move' }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setDragState({ kind: 'line-endpoint', id: line.id, endpoint: 1, moved: false });
                      }}
                    />
                    <circle
                      cx={line.x2}
                      cy={line.y2}
                      r={1.8}
                      fill="#fef3c7"
                      stroke="#d97706"
                      strokeWidth={0.6}
                      style={{ cursor: 'move' }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setDragState({ kind: 'line-endpoint', id: line.id, endpoint: 2, moved: false });
                      }}
                    />
                  </>
                )}
              </g>
            );
          })}

          {/* Cutouts with Corner Resize Handles */}
          {design.cutouts.map((cutout) => {
            const isSel = selection?.kind === 'cutout' && selection.cutoutId === cutout.id;
            const isFaucet = cutout.type === 'faucet';
            const hw = cutout.width / 2;
            const hh = cutout.height / 2;

            return (
              <g
                key={cutout.id}
                transform={`translate(${cutout.x}, ${cutout.y}) rotate(${cutout.rotation})`}
                style={{ cursor: isDrawingLines ? 'crosshair' : 'grab' }}
                onPointerDown={(e) => {
                  if (isDrawingLines) return;
                  e.stopPropagation();
                  const raw = toSvgCoords(e.clientX, e.clientY);
                  setSelection({ kind: 'cutout', cutoutId: cutout.id });
                  setDragState({
                    kind: 'cutout-move',
                    id: cutout.id,
                    offsetX: raw.x - cutout.x,
                    offsetY: raw.y - cutout.y,
                    startPointer: raw,
                    moved: false,
                  });
                }}
              >
                {isFaucet ? (
                  <>
                    <circle
                      cx={0}
                      cy={0}
                      r={Math.max(1.2, hw)}
                      fill="#f8fafc"
                      stroke={isSel ? '#d97706' : '#334155'}
                      strokeWidth={isSel ? 0.7 : 0.5}
                    />
                    <circle cx={0} cy={0} r={0.5} fill="#64748b" />
                  </>
                ) : (
                  <>
                    <rect
                      x={-hw}
                      y={-hh}
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
                        <circle cx={-cutout.width * 0.24} cy={-cutout.height * 0.22} r={Math.min(3.2, cutout.height * 0.16)} fill="none" stroke="#94a3b8" strokeWidth={0.45} />
                        <circle cx={cutout.width * 0.24} cy={-cutout.height * 0.22} r={Math.min(2.6, cutout.height * 0.13)} fill="none" stroke="#94a3b8" strokeWidth={0.45} />
                        <circle cx={-cutout.width * 0.24} cy={cutout.height * 0.22} r={Math.min(2.6, cutout.height * 0.13)} fill="none" stroke="#94a3b8" strokeWidth={0.45} />
                        <circle cx={cutout.width * 0.24} cy={cutout.height * 0.22} r={Math.min(3.5, cutout.height * 0.17)} fill="none" stroke="#94a3b8" strokeWidth={0.45} />
                      </>
                    ) : (
                      <>
                        <rect
                          x={-hw + 1.5}
                          y={-hh + 1.5}
                          width={Math.max(2, cutout.width - 3)}
                          height={Math.max(2, cutout.height - 3)}
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
                      y={hh + 3.2}
                      fontSize={2.4}
                      fontWeight={600}
                      fill="#334155"
                      pointerEvents="none"
                    >
                      {CUTOUT_CATALOG[cutout.type].shortLabel} ({cutout.width}"×{cutout.height}")
                    </text>
                  </>
                )}

                {!isDrawingLines && isSel && (
                  <>
                    {(
                      [
                        { h: 'nw', x: -hw, y: -hh, cur: 'nwse-resize' },
                        { h: 'ne', x: hw, y: -hh, cur: 'nesw-resize' },
                        { h: 'se', x: hw, y: hh, cur: 'nwse-resize' },
                        { h: 'sw', x: -hw, y: hh, cur: 'nesw-resize' },
                      ] as const
                    ).map((item) => (
                      <rect
                        key={`c_res_${item.h}`}
                        x={item.x - 1.3}
                        y={item.y - 1.3}
                        width={2.6}
                        height={2.6}
                        fill="#fef3c7"
                        stroke="#d97706"
                        strokeWidth={0.5}
                        style={{ cursor: item.cur }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setDragState({
                            kind: 'cutout-resize',
                            id: cutout.id,
                            handle: item.h,
                            orig: { ...cutout },
                            moved: false,
                          });
                        }}
                      />
                    ))}
                  </>
                )}
              </g>
            );
          })}

          {/* Draw Lines Overlay */}
          {isDrawingLines && (
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

        <div className="canvas-legend">
          <span><i className="legend-swatch finished" /> Finished Edge</span>
          <span><i className="legend-swatch wall" /> Wall Edge</span>
          <span><i className="legend-swatch splash" /> 4" Backsplash</span>
          <span className="muted">
            Click countertop or cutout to move &amp; resize · Drag corners to reshape · Click any edge to toggle wall/finished
          </span>
        </div>
      </div>

      {/* Contextual Selection Bar for Selected Item */}
      {selection?.kind === 'piece' && selectedPiece && selectedPieceBounds && (
        <div className="selection-bar">
          <div className="selection-fields">
            <strong>{selectedPiece.label}</strong>
            <label>
              Width (in)
              <input
                type="number"
                min={6}
                max={300}
                step={0.5}
                value={selectedPieceBounds.width}
                onChange={(e) => {
                  const nextW = Math.max(6, Number(e.target.value) || 6);
                  updatePiece(
                    selectedPiece.id,
                    (p) =>
                      resizePieceToBounds(
                        p,
                        selectedPieceBounds.minX,
                        selectedPieceBounds.minY,
                        nextW,
                        selectedPieceBounds.height,
                      ),
                    { recordHistory: true, convertedToCustom: true },
                  );
                }}
              />
            </label>
            <label>
              Depth (in)
              <input
                type="number"
                min={6}
                max={240}
                step={0.5}
                value={selectedPieceBounds.height}
                onChange={(e) => {
                  const nextH = Math.max(6, Number(e.target.value) || 6);
                  updatePiece(
                    selectedPiece.id,
                    (p) =>
                      resizePieceToBounds(
                        p,
                        selectedPieceBounds.minX,
                        selectedPieceBounds.minY,
                        selectedPieceBounds.width,
                        nextH,
                      ),
                    { recordHistory: true, convertedToCustom: true },
                  );
                }}
              />
            </label>
            <label>
              X (in)
              <input
                type="number"
                step={1}
                value={round2(selectedPieceBounds.minX)}
                onChange={(e) => {
                  const dx = (Number(e.target.value) || 0) - selectedPieceBounds.minX;
                  updatePiece(
                    selectedPiece.id,
                    (p) => ({
                      ...p,
                      points: p.points.map((pt) => ({ x: round2(pt.x + dx), y: pt.y })),
                    }),
                    { recordHistory: true },
                  );
                }}
              />
            </label>
            <label>
              Y (in)
              <input
                type="number"
                step={1}
                value={round2(selectedPieceBounds.minY)}
                onChange={(e) => {
                  const dy = (Number(e.target.value) || 0) - selectedPieceBounds.minY;
                  updatePiece(
                    selectedPiece.id,
                    (p) => ({
                      ...p,
                      points: p.points.map((pt) => ({ x: pt.x, y: round2(pt.y + dy) })),
                    }),
                    { recordHistory: true },
                  );
                }}
              />
            </label>
          </div>

          <div className="toolbar-group">
            <button type="button" className="btn-chip" onClick={addCounterPiece}>
              + Add Piece
            </button>
            <button type="button" className="btn-chip" onClick={() => seedDrawFromPoint()}>
              ✎ Draw Lines
            </button>
            <button type="button" className="btn-chip" onClick={() => addCutout('undermount_sink', selectedPiece)}>
              + Sink
            </button>
            <button type="button" className="btn-chip" onClick={() => rotatePiece90(selectedPiece)}>
              Rotate 90°
            </button>
            <button type="button" className="btn-chip" onClick={() => duplicatePiece(selectedPiece)}>
              Duplicate
            </button>
            {design.pieces.length > 1 && (
              <button
                type="button"
                className="btn-chip danger"
                onClick={() => deletePiece(selectedPiece.id)}
              >
                Delete Piece
              </button>
            )}
          </div>
        </div>
      )}

      {selection?.kind === 'cutout' && selectedCutout && (
        <div className="selection-bar">
          <div className="selection-fields">
            <strong>{CUTOUT_CATALOG[selectedCutout.type].label}</strong>
            <label>
              Width (in)
              <input
                type="number"
                min={selectedCutout.type === 'faucet' ? 1 : 6}
                max={96}
                step={0.5}
                value={selectedCutout.width}
                onChange={(e) =>
                  updateCutout(selectedCutout.id, {
                    width: Math.max(selectedCutout.type === 'faucet' ? 1 : 6, Number(e.target.value) || 6),
                  })
                }
              />
            </label>
            <label>
              Height (in)
              <input
                type="number"
                min={selectedCutout.type === 'faucet' ? 1 : 6}
                max={96}
                step={0.5}
                value={selectedCutout.height}
                onChange={(e) =>
                  updateCutout(selectedCutout.id, {
                    height: Math.max(selectedCutout.type === 'faucet' ? 1 : 6, Number(e.target.value) || 6),
                  })
                }
              />
            </label>
            <label>
              X (in)
              <input
                type="number"
                step={0.5}
                value={selectedCutout.x}
                onChange={(e) => updateCutout(selectedCutout.id, { x: Number(e.target.value) || 0 })}
              />
            </label>
            <label>
              Y (in)
              <input
                type="number"
                step={0.5}
                value={selectedCutout.y}
                onChange={(e) => updateCutout(selectedCutout.id, { y: Number(e.target.value) || 0 })}
              />
            </label>
          </div>
          <div className="toolbar-group">
            {selectedCutout.type !== 'faucet' && (
              <button
                type="button"
                className="btn-chip"
                onClick={() =>
                  updateCutout(selectedCutout.id, { rotation: (selectedCutout.rotation + 90) % 180 })
                }
              >
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

      {selection?.kind === 'edge' && selectedPiece && (
        <div className="selection-bar">
          {(() => {
            const idx = selection.edgeIndex;
            const edge = selectedPiece.edges[idx];
            const a = selectedPiece.points[idx];
            const b = selectedPiece.points[(idx + 1) % selectedPiece.points.length];
            const len = a && b ? round2(Math.hypot(b.x - a.x, b.y - a.y)) : 0;
            if (!edge || !a || !b) return null;

            return (
              <>
                <div className="selection-fields">
                  <strong>
                    {selectedPiece.label} — Edge #{idx + 1}
                  </strong>
                  <label>
                    Length (in)
                    <input
                      type="number"
                      min={2}
                      max={300}
                      step={0.5}
                      value={len}
                      onChange={(e) => setEdgeLength(selectedPiece.id, idx, Number(e.target.value) || 2)}
                    />
                  </label>
                </div>
                <div className="toolbar-group">
                  <button
                    type="button"
                    className={`btn-chip ${edge.kind === 'finished' ? 'active' : ''}`}
                    onClick={() => toggleEdgeKind(selectedPiece.id, idx)}
                  >
                    {edge.kind === 'finished' ? 'Finished Edge (Click for Wall)' : 'Wall Edge (Click for Finished)'}
                  </button>
                  {edge.kind === 'wall' && (
                    <label className="inline-check">
                      <input
                        type="checkbox"
                        checked={edge.backsplash}
                        onChange={() => toggleEdgeBacksplash(selectedPiece.id, idx)}
                      />
                      4" Backsplash ($22/lin ft)
                    </label>
                  )}
                  <button type="button" className="btn-chip" onClick={() => splitEdge(selectedPiece.id, idx)}>
                    + Split Edge
                  </button>
                  <button
                    type="button"
                    className="btn-chip"
                    onClick={() => addBumpoutOnEdge(selectedPiece.id, idx)}
                  >
                    + 6" Bumpout
                  </button>
                  <button
                    type="button"
                    className="btn-chip"
                    onClick={() => seedDrawFromPoint({ x: round2((a.x + b.x) / 2), y: round2((a.y + b.y) / 2) })}
                  >
                    ✎ Draw Lines from Edge
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {selection?.kind === 'vertex' && selectedPiece && selectedPiece.points[selection.vertexIndex] && (
        <div className="selection-bar">
          {(() => {
            const vIdx = selection.vertexIndex;
            const pt = selectedPiece.points[vIdx];
            return (
              <>
                <div className="selection-fields">
                  <strong>Corner #{vIdx + 1}</strong>
                  <label>
                    X (in)
                    <input
                      type="number"
                      step={0.5}
                      value={pt.x}
                      onChange={(e) =>
                        updatePiece(
                          selectedPiece.id,
                          (p) => ({
                            ...p,
                            points: p.points.map((v, i) =>
                              i === vIdx ? { ...v, x: Number(e.target.value) || 0 } : v,
                            ),
                          }),
                          { recordHistory: true, convertedToCustom: true },
                        )
                      }
                    />
                  </label>
                  <label>
                    Y (in)
                    <input
                      type="number"
                      step={0.5}
                      value={pt.y}
                      onChange={(e) =>
                        updatePiece(
                          selectedPiece.id,
                          (p) => ({
                            ...p,
                            points: p.points.map((v, i) =>
                              i === vIdx ? { ...v, y: Number(e.target.value) || 0 } : v,
                            ),
                          }),
                          { recordHistory: true, convertedToCustom: true },
                        )
                      }
                    />
                  </label>
                </div>
                <div className="toolbar-group">
                  <button type="button" className="btn-chip" onClick={() => seedDrawFromPoint(pt)}>
                    ✎ Draw Lines from Corner
                  </button>
                  <button
                    type="button"
                    className="btn-chip danger"
                    onClick={() => removeVertex(selectedPiece.id, vIdx)}
                    disabled={selectedPiece.points.length <= 3}
                  >
                    Delete Corner
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {selection?.kind === 'line' && selectedLine && (
        <div className="selection-bar">
          {(() => {
            const len = round2(Math.hypot(selectedLine.x2 - selectedLine.x1, selectedLine.y2 - selectedLine.y1));
            return (
              <>
                <div className="selection-fields">
                  <strong>Reference / Seam Line</strong>
                  <label>
                    Length (in)
                    <input
                      type="number"
                      min={1}
                      max={300}
                      step={0.5}
                      value={len}
                      onChange={(e) => {
                        const target = Math.max(1, Number(e.target.value) || 1);
                        const dx = selectedLine.x2 - selectedLine.x1;
                        const dy = selectedLine.y2 - selectedLine.y1;
                        const cur = Math.hypot(dx, dy) || 1;
                        const s = target / cur;
                        onDesignChange(
                          {
                            ...design,
                            lines: design.lines.map((l) =>
                              l.id === selectedLine.id
                                ? {
                                    ...l,
                                    x2: round2(l.x1 + dx * s),
                                    y2: round2(l.y1 + dy * s),
                                  }
                                : l,
                            ),
                          },
                          { recordHistory: true },
                        );
                      }}
                    />
                  </label>
                </div>
                <div className="toolbar-group">
                  <button
                    type="button"
                    className="btn-chip danger"
                    onClick={() => removeLine(selectedLine.id)}
                  >
                    Delete Line
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
