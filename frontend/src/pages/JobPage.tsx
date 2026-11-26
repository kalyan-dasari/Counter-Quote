import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getJob, updateJob } from '../api';
import edgeProfilesImg from '../assets/EdgeProfiles.png';
import { CounterCanvas } from '../components/CounterCanvas';
import {
  CORNER_FINISHES,
  EDGE_PROFILES,
  MATERIALS,
  THICKNESSES,
  calculateQuoteBreakdown,
  createLShapeDesign,
  createRectangleDesign,
  createUShapeDesign,
  formatCurrency,
  getPieceBounds,
  parseDesignJson,
} from '../quote';
import type { CounterDesign, Job, ShapeType } from '../types';

const MAX_HISTORY = 50;

function EdgeProfilePreview({ profile }: { profile: string }) {
  const opt = EDGE_PROFILES.find((e) => e.name === profile) ?? EDGE_PROFILES[0];
  let path = 'M 6 10 L 66 10 Q 70 10 70 14 L 70 30 Q 70 34 66 34 L 6 34 Z';
  switch (profile) {
    case 'Half Bullnose':
      path = 'M 6 10 L 54 10 Q 70 10 70 26 L 70 34 L 6 34 Z';
      break;
    case 'Bevel':
      path = 'M 6 10 L 58 10 L 70 22 L 70 34 L 6 34 Z';
      break;
    case 'Full Bullnose':
      path = 'M 6 10 L 58 10 A 12 12 0 0 1 58 34 L 6 34 Z';
      break;
    case 'Ogee':
      path = 'M 6 10 L 48 10 C 56 10 56 20 62 20 C 68 20 70 24 70 34 L 6 34 Z';
      break;
    case 'Mitered':
      path = 'M 6 10 L 70 10 L 70 42 L 54 42 L 54 28 L 6 28 Z';
      break;
  }

  return (
    <div className="edge-preview">
      <svg width="78" height="46" viewBox="0 0 78 46" aria-hidden="true">
        <path d={path} fill="#e2e8f0" stroke="#1d5fa8" strokeWidth="2" />
      </svg>
      <div>
        <div className="edge-preview-name">{opt.name}</div>
        <div className="line-detail">{opt.note}</div>
      </div>
    </div>
  );
}

export function JobPage() {
  const id = Number(useParams().id);
  const queryClient = useQueryClient();
  const { data: job, error } = useQuery({ queryKey: ['jobs', id], queryFn: () => getJob(id) });

  const [customerName, setCustomerName] = useState('');
  const [material, setMaterial] = useState('Granite');
  const [thickness, setThickness] = useState('3cm');
  const [edgeProfile, setEdgeProfile] = useState('Eased');
  const [cornerFinish, setCornerFinish] = useState('Standard');
  const [includeTemplating, setIncludeTemplating] = useState(true);
  const [includeRemoval, setIncludeRemoval] = useState(false);
  const [shapeType, setShapeType] = useState<ShapeType>('rectangle');
  const [design, setDesign] = useState<CounterDesign>(() => createRectangleDesign());
  const [past, setPast] = useState<CounterDesign[]>([]);
  const [future, setFuture] = useState<CounterDesign[]>([]);
  const [notes, setNotes] = useState('');
  const [dirty, setDirty] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [isDrawingLines, setIsDrawingLines] = useState(false);
  const [showEdgeGuide, setShowEdgeGuide] = useState(false);

  const designRef = useRef(design);
  designRef.current = design;

  // Parametric dimensions for quick preset editing
  const [rectWidth, setRectWidth] = useState(72);
  const [rectDepth, setRectDepth] = useState(25.5);
  const [rectIsland, setRectIsland] = useState(false);

  const [lTopWidth, setLTopWidth] = useState(108);
  const [lTopDepth, setLTopDepth] = useState(25.5);
  const [lLeftLen, setLLeftLen] = useState(78);
  const [lLeftDepth, setLLeftDepth] = useState(25.5);
  const [lAngle, setLAngle] = useState(90);

  const [uBackWidth, setUBackWidth] = useState(108);
  const [uLeftLen, setULeftLen] = useState(72);
  const [uRightLen, setURightLen] = useState(72);
  const [uDepth, setUDepth] = useState(25.5);

  useEffect(() => {
    if (!job) return;
    setCustomerName(job.customerName);
    setMaterial(job.material || 'Granite');
    setThickness(job.thickness || '3cm');
    setEdgeProfile(job.edgeProfile || 'Eased');
    setCornerFinish(job.cornerFinish || 'Standard');
    setIncludeTemplating(job.includeTemplating);
    setIncludeRemoval(job.includeRemoval);
    const st = (['rectangle', 'l-shape', 'u-shape', 'custom'].includes(job.shapeType)
      ? job.shapeType
      : 'rectangle') as ShapeType;
    setShapeType(st);
    const parsed = parseDesignJson(job.designJson);
    setDesign(parsed);
    setPast([]);
    setFuture([]);
    setNotes(job.notes || '');
    setDirty(false);
    setIsDrawingLines(false);

    if (st === 'rectangle' && parsed.pieces[0]?.points.length === 4) {
      const b = getPieceBounds(parsed.pieces[0].points);
      setRectWidth(b.width);
      setRectDepth(b.height);
      setRectIsland(parsed.pieces[0].edges.every((e) => e.kind === 'finished'));
    }
  }, [job]);

  const commitDesign = useCallback(
    (
      next: CounterDesign,
      options?: { recordHistory?: boolean; convertedToCustom?: boolean },
    ) => {
      if (options?.recordHistory !== false) {
        setPast((prev) => [...prev.slice(-(MAX_HISTORY - 1)), designRef.current]);
        setFuture([]);
      }
      if (options?.convertedToCustom) {
        setShapeType('custom');
      }
      setDesign(next);
      setDirty(true);
    },
    [],
  );

  const handleBeginDragHistory = useCallback(() => {
    setPast((prev) => [...prev.slice(-(MAX_HISTORY - 1)), designRef.current]);
    setFuture([]);
  }, []);

  const handleUndo = useCallback(() => {
    setPast((prevPast) => {
      if (prevPast.length === 0) return prevPast;
      const previous = prevPast[prevPast.length - 1];
      setFuture((prevFuture) => [designRef.current, ...prevFuture]);
      setDesign(previous);
      setDirty(true);
      return prevPast.slice(0, -1);
    });
  }, []);

  const handleRedo = useCallback(() => {
    setFuture((prevFuture) => {
      if (prevFuture.length === 0) return prevFuture;
      const next = prevFuture[0];
      setPast((prevPast) => [...prevPast.slice(-(MAX_HISTORY - 1)), designRef.current]);
      setDesign(next);
      setDirty(true);
      return prevFuture.slice(1);
    });
  }, []);

  // Keyboard shortcuts for Undo / Redo
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowEdgeGuide(false);
        return;
      }
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

  const saveMutation = useMutation({
    mutationFn: (payload: Job) => updateJob(payload),
    onSuccess: (updated) => {
      queryClient.setQueryData(['jobs', id], updated);
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setDirty(false);
      setSavedNotice(true);
      window.setTimeout(() => setSavedNotice(false), 2500);
    },
  });

  const breakdown = useMemo(
    () =>
      calculateQuoteBreakdown(
        {
          material,
          thickness,
          edgeProfile,
          cornerFinish,
          includeTemplating,
          includeRemoval,
        },
        design,
      ),
    [material, thickness, edgeProfile, cornerFinish, includeTemplating, includeRemoval, design],
  );

  const hasOverlengthRun = useMemo(() => {
    for (const piece of design.pieces) {
      const b = getPieceBounds(piece.points);
      if (b.width > 120 || b.height > 120) return true;
      for (let i = 0; i < piece.points.length; i++) {
        const a = piece.points[i];
        const next = piece.points[(i + 1) % piece.points.length];
        if (Math.hypot(next.x - a.x, next.y - a.y) > 120) return true;
      }
    }
    return false;
  }, [design.pieces]);

  const handleSave = () => {
    if (!job) return;
    const payload: Job = {
      ...job,
      customerName: customerName.trim() || job.customerName,
      material,
      thickness,
      edgeProfile,
      cornerFinish,
      includeTemplating,
      includeRemoval,
      shapeType,
      designJson: JSON.stringify(design),
      areaSqFt: breakdown.metrics.areaSqFt,
      finishedEdgeLinFt: breakdown.metrics.finishedEdgeLinFt,
      backsplashLinFt: breakdown.metrics.backsplashLinFt,
      insideCorners: breakdown.metrics.insideCorners,
      outsideFinishedCorners: breakdown.metrics.outsideFinishedCorners,
      angledCorners: breakdown.metrics.angledCorners,
      cutoutCount: breakdown.metrics.cutoutCount,
      totalPrice: breakdown.totalPrice,
      notes,
    };
    saveMutation.mutate(payload);
  };

  const selectShapePreset = (nextShape: ShapeType) => {
    setIsDrawingLines(false);
    setShapeType(nextShape);
    if (nextShape === 'rectangle') {
      const next = createRectangleDesign(rectWidth, rectDepth, rectIsland);
      commitDesign({ ...next, cutouts: design.cutouts, lines: design.lines });
    } else if (nextShape === 'l-shape') {
      const next = createLShapeDesign(lTopWidth, lTopDepth, lLeftLen, lLeftDepth, lAngle);
      commitDesign({ ...next, cutouts: design.cutouts, lines: design.lines });
    } else if (nextShape === 'u-shape') {
      const next = createUShapeDesign(uBackWidth, uLeftLen, uRightLen, uDepth);
      commitDesign({ ...next, cutouts: design.cutouts, lines: design.lines });
    } else {
      setIsDrawingLines(true);
    }
  };

  const applyRectParams = (w: number, d: number, island: boolean) => {
    setRectWidth(w);
    setRectDepth(d);
    setRectIsland(island);
    const next = createRectangleDesign(w, d, island);
    commitDesign({ ...next, cutouts: design.cutouts, lines: design.lines });
  };

  const applyLParams = (tw: number, td: number, ll: number, ld: number, ang: number) => {
    setLTopWidth(tw);
    setLTopDepth(td);
    setLLeftLen(ll);
    setLLeftDepth(ld);
    setLAngle(ang);
    const next = createLShapeDesign(tw, td, ll, ld, ang);
    commitDesign({ ...next, cutouts: design.cutouts, lines: design.lines });
  };

  const applyUParams = (bw: number, ll: number, rl: number, d: number) => {
    setUBackWidth(bw);
    setULeftLen(ll);
    setURightLen(rl);
    setUDepth(d);
    const next = createUShapeDesign(bw, ll, rl, d);
    commitDesign({ ...next, cutouts: design.cutouts, lines: design.lines });
  };

  if (error) return <p className="errors">{error.message}</p>;
  if (!job) return <p>Loading…</p>;

  return (
    <div className="job-workspace">
      <div className="job-topbar">
        <div className="job-title-group">
          <Link to="/" className="back-link no-print">
            ← All Jobs
          </Link>
          <input
            className="customer-input"
            value={customerName}
            onChange={(e) => {
              setCustomerName(e.target.value);
              setDirty(true);
            }}
            aria-label="Customer name"
          />
          {dirty ? (
            <span className="status-pill unsaved no-print">Unsaved changes</span>
          ) : savedNotice ? (
            <span className="status-pill saved no-print">Saved</span>
          ) : null}
        </div>
        <div className="toolbar-group no-print">
          <button type="button" className="btn-chip" onClick={() => window.print()}>
            Print Quote
          </button>
          <button
            type="button"
            className="button"
            onClick={handleSave}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save Quote'}
          </button>
        </div>
      </div>

      {saveMutation.error && <p className="errors">{saveMutation.error.message}</p>}

      <div className="workspace-grid">
        <section className="drawing-column">
          <div className="card shape-panel no-print">
            <div className="shape-tabs">
              <span className="toolbar-label">Counter Shape:</span>
              {(['rectangle', 'l-shape', 'u-shape'] as ShapeType[]).map((st) => (
                <button
                  key={st}
                  type="button"
                  className={`btn-tab ${shapeType === st && !isDrawingLines ? 'active' : ''}`}
                  onClick={() => selectShapePreset(st)}
                >
                  {st === 'rectangle' ? 'Rectangle' : st === 'l-shape' ? 'L-Shape' : 'U-Shape'}
                </button>
              ))}
              <button
                type="button"
                className={`btn-tab ${shapeType === 'custom' || isDrawingLines ? 'active' : ''}`}
                onClick={() => selectShapePreset('custom')}
              >
                {isDrawingLines ? 'Drawing Lines…' : 'Draw Lines / Custom'}
              </button>
            </div>

            {shapeType === 'rectangle' && !isDrawingLines && (
              <div className="param-row">
                <label>
                  Width (in)
                  <input
                    type="number"
                    min={12}
                    max={240}
                    step={0.5}
                    value={rectWidth}
                    onChange={(e) => applyRectParams(Number(e.target.value) || 12, rectDepth, rectIsland)}
                  />
                </label>
                <label>
                  Depth (in)
                  <input
                    type="number"
                    min={12}
                    max={96}
                    step={0.5}
                    value={rectDepth}
                    onChange={(e) => applyRectParams(rectWidth, Number(e.target.value) || 12, rectIsland)}
                  />
                </label>
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={rectIsland}
                    onChange={(e) => applyRectParams(rectWidth, rectDepth, e.target.checked)}
                  />
                  Island (all 4 edges finished)
                </label>
              </div>
            )}

            {shapeType === 'l-shape' && !isDrawingLines && (
              <div className="param-row">
                <label>
                  Top Run (in)
                  <input
                    type="number"
                    min={36}
                    max={240}
                    step={0.5}
                    value={lTopWidth}
                    onChange={(e) =>
                      applyLParams(Number(e.target.value) || 36, lTopDepth, lLeftLen, lLeftDepth, lAngle)
                    }
                  />
                </label>
                <label>
                  Top Depth (in)
                  <input
                    type="number"
                    min={12}
                    max={60}
                    step={0.5}
                    value={lTopDepth}
                    onChange={(e) =>
                      applyLParams(lTopWidth, Number(e.target.value) || 12, lLeftLen, lLeftDepth, lAngle)
                    }
                  />
                </label>
                <label>
                  Left Leg (in)
                  <input
                    type="number"
                    min={36}
                    max={240}
                    step={0.5}
                    value={lLeftLen}
                    onChange={(e) =>
                      applyLParams(lTopWidth, lTopDepth, Number(e.target.value) || 36, lLeftDepth, lAngle)
                    }
                  />
                </label>
                <label>
                  Left Depth (in)
                  <input
                    type="number"
                    min={12}
                    max={60}
                    step={0.5}
                    value={lLeftDepth}
                    onChange={(e) =>
                      applyLParams(lTopWidth, lTopDepth, lLeftLen, Number(e.target.value) || 12, lAngle)
                    }
                  />
                </label>
                <label>
                  Corner Angle (°)
                  <input
                    type="number"
                    min={45}
                    max={135}
                    step={1}
                    value={lAngle}
                    onChange={(e) =>
                      applyLParams(lTopWidth, lTopDepth, lLeftLen, lLeftDepth, Number(e.target.value) || 90)
                    }
                  />
                </label>
              </div>
            )}

            {shapeType === 'u-shape' && !isDrawingLines && (
              <div className="param-row">
                <label>
                  Back Width (in)
                  <input
                    type="number"
                    min={60}
                    max={240}
                    step={0.5}
                    value={uBackWidth}
                    onChange={(e) =>
                      applyUParams(Number(e.target.value) || 60, uLeftLen, uRightLen, uDepth)
                    }
                  />
                </label>
                <label>
                  Left Leg (in)
                  <input
                    type="number"
                    min={36}
                    max={180}
                    step={0.5}
                    value={uLeftLen}
                    onChange={(e) =>
                      applyUParams(uBackWidth, Number(e.target.value) || 36, uRightLen, uDepth)
                    }
                  />
                </label>
                <label>
                  Right Leg (in)
                  <input
                    type="number"
                    min={36}
                    max={180}
                    step={0.5}
                    value={uRightLen}
                    onChange={(e) =>
                      applyUParams(uBackWidth, uLeftLen, Number(e.target.value) || 36, uDepth)
                    }
                  />
                </label>
                <label>
                  Depth (in)
                  <input
                    type="number"
                    min={12}
                    max={48}
                    step={0.5}
                    value={uDepth}
                    onChange={(e) =>
                      applyUParams(uBackWidth, uLeftLen, uRightLen, Number(e.target.value) || 12)
                    }
                  />
                </label>
              </div>
            )}

            {shapeType === 'custom' && !isDrawingLines && (
              <div className="param-row">
                <span className="muted">
                  Custom layout ({design.pieces.length} piece{design.pieces.length === 1 ? '' : 's'}). Click any
                  countertop piece or cutout to move &amp; resize it, or click <strong>+ Counter Piece</strong> /{' '}
                  <strong>✎ Draw Lines</strong>.
                </span>
              </div>
            )}
          </div>

          <CounterCanvas
            design={design}
            material={material}
            thickness={thickness}
            edgeProfile={edgeProfile}
            cornerFinish={cornerFinish}
            metrics={breakdown.metrics}
            isDrawingLines={isDrawingLines}
            canUndo={past.length > 0}
            canRedo={future.length > 0}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onBeginDragHistory={handleBeginDragHistory}
            onDesignChange={commitDesign}
            onStartDrawLines={() => setIsDrawingLines(true)}
            onFinishDrawLines={() => {
              setIsDrawingLines(false);
              setShapeType('custom');
            }}
            onCancelDrawLines={() => setIsDrawingLines(false)}
          />
        </section>

        <aside className="quote-column">
          <div className="card">
            <h2>Specifications</h2>
            <div className="specs-form">
              <label>
                Material
                <select
                  value={material}
                  onChange={(e) => {
                    setMaterial(e.target.value);
                    setDirty(true);
                  }}
                >
                  {MATERIALS.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name} (${m.ratePerSqFt}/sq ft)
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Slab Thickness
                <select
                  value={thickness}
                  onChange={(e) => {
                    setThickness(e.target.value);
                    setDirty(true);
                  }}
                >
                  {THICKNESSES.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.label} {t.adderPerSqFt > 0 ? `(+$${t.adderPerSqFt}/sq ft)` : '(Base)'}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span className="label-with-help">
                  <span>Edge Profile</span>
                  <button
                    type="button"
                    className="help-icon-btn"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowEdgeGuide(true);
                    }}
                    title="View Edge Profiles, Corners & Thickness visual guide"
                    aria-label="View Edge Profiles visual guide"
                  >
                    ? View Guide
                  </button>
                </span>
                <select
                  value={edgeProfile}
                  onChange={(e) => {
                    setEdgeProfile(e.target.value);
                    setDirty(true);
                  }}
                >
                  {EDGE_PROFILES.map((ep) => (
                    <option key={ep.name} value={ep.name}>
                      {ep.name} {ep.ratePerLinFt > 0 ? `(+$${ep.ratePerLinFt}/lin ft)` : '(Included)'}
                    </option>
                  ))}
                </select>
              </label>
              <EdgeProfilePreview profile={edgeProfile} />

              <label>
                <span className="label-with-help">
                  <span>Outside Corner Finish</span>
                  <button
                    type="button"
                    className="help-icon-btn"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowEdgeGuide(true);
                    }}
                    title="View Corner Finish visual guide"
                    aria-label="View Corner Finish visual guide"
                  >
                    ?
                  </button>
                </span>
                <select
                  value={cornerFinish}
                  onChange={(e) => {
                    setCornerFinish(e.target.value);
                    setDirty(true);
                  }}
                >
                  {CORNER_FINISHES.map((cf) => (
                    <option key={cf.name} value={cf.name}>
                      {cf.name} {cf.ratePerCorner > 0 ? `(+$${cf.ratePerCorner}/corner)` : '(Included)'}
                    </option>
                  ))}
                </select>
              </label>

              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={includeTemplating}
                  onChange={(e) => {
                    setIncludeTemplating(e.target.checked);
                    setDirty(true);
                  }}
                />
                Laser Templating &amp; Install ($250)
              </label>

              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={includeRemoval}
                  onChange={(e) => {
                    setIncludeRemoval(e.target.checked);
                    setDirty(true);
                  }}
                />
                Old Counter Tear-Out ($10/sq ft)
              </label>

              <label>
                Shop Notes
                <textarea
                  rows={2}
                  value={notes}
                  placeholder="Sink model, seam preferences, overhang details…"
                  onChange={(e) => {
                    setNotes(e.target.value);
                    setDirty(true);
                  }}
                />
              </label>
            </div>
          </div>

          <div className="card metrics-card">
            <h2>Measured Geometry</h2>
            <div className="metrics-grid">
              <div>
                <span className="metric-val">{breakdown.metrics.areaSqFt}</span>
                <span className="metric-lbl">Sq Ft</span>
              </div>
              <div>
                <span className="metric-val">{breakdown.metrics.finishedEdgeLinFt}</span>
                <span className="metric-lbl">Finished Lin Ft</span>
              </div>
              <div>
                <span className="metric-val">{breakdown.metrics.backsplashLinFt}</span>
                <span className="metric-lbl">Backsplash Lin Ft</span>
              </div>
              <div>
                <span className="metric-val">{breakdown.metrics.insideCorners}</span>
                <span className="metric-lbl">Inside Corners</span>
              </div>
              <div>
                <span className="metric-val">{breakdown.metrics.cutoutCount}</span>
                <span className="metric-lbl">Cutouts</span>
              </div>
              <div>
                <span className="metric-val">{breakdown.metrics.estimatedSlabs}</span>
                <span className="metric-lbl">Est. Slabs (50 sf)</span>
              </div>
            </div>
            {(hasOverlengthRun || breakdown.metrics.angledCorners > 0) && (
              <div className="shop-advisories">
                {hasOverlengthRun && (
                  <div className="advisory-pill">
                    Run &gt; 120&quot; — exceeds standard slab length; plan a field seam or jumbo slab.
                  </div>
                )}
                {breakdown.metrics.angledCorners > 0 && (
                  <div className="advisory-pill info">
                    {breakdown.metrics.angledCorners} non-90° angled corner
                    {breakdown.metrics.angledCorners === 1 ? '' : 's'} detected (+$65/corner CNC setup).
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="card quote-card">
            <h2>Itemized Quote</h2>
            {breakdown.lines.length === 0 ? (
              <p className="muted">Draw a countertop shape to calculate a quote.</p>
            ) : (
              <>
                <ul className="quote-lines">
                  {breakdown.lines.map((line, i) => (
                    <li key={i}>
                      <div>
                        <div className="line-title">{line.label}</div>
                        <div className="line-detail">{line.detail}</div>
                      </div>
                      <div className="line-amount">{formatCurrency(line.amount)}</div>
                    </li>
                  ))}
                </ul>
                <div className="quote-total">
                  <span>Estimated Total</span>
                  <strong>{formatCurrency(breakdown.totalPrice)}</strong>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      {showEdgeGuide && (
        <div
          className="guide-modal-backdrop no-print"
          role="dialog"
          aria-modal="true"
          aria-label="Edge Profiles, Outside Corners, and Thickness Guide"
          onClick={() => setShowEdgeGuide(false)}
        >
          <div className="guide-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="guide-modal-header">
              <strong>Edge Profiles, Corner Finish &amp; Thickness Guide</strong>
              <button
                type="button"
                className="btn-chip"
                onClick={() => setShowEdgeGuide(false)}
              >
                ✕ Close
              </button>
            </div>
            <img
              src={edgeProfilesImg}
              alt="Visual guide showing Eased, Half Bullnose, Bevel, Full Bullnose, Ogee, Mitered edge profiles, Standard/Radius/Clipped outside corners, and slab thickness"
              className="guide-modal-img"
            />
          </div>
        </div>
      )}
    </div>
  );
}
