import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createJob } from '../api';
import { MATERIALS, createDefaultDesignForShape } from '../quote';
import type { ShapeType } from '../types';

const SHAPES: Array<{ value: ShapeType; label: string; desc: string }> = [
  { value: 'rectangle', label: 'Rectangle', desc: 'Straight run or island' },
  { value: 'l-shape', label: 'L-Shape', desc: 'Two legs with inside corner' },
  { value: 'u-shape', label: 'U-Shape', desc: 'Three legs, two inside corners' },
  { value: 'custom', label: 'Custom / Freehand', desc: 'Start with a rectangle and draw/edit points' },
];

export function NewJobPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [customerName, setCustomerName] = useState('');
  const [material, setMaterial] = useState(MATERIALS[0].name);
  const [shapeType, setShapeType] = useState<ShapeType>('rectangle');

  const save = useMutation({
    mutationFn: createJob,
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      navigate(`/jobs/${job.id}`);
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const initialDesign = createDefaultDesignForShape(shapeType);
    save.mutate({
      customerName,
      material,
      shapeType,
      designJson: JSON.stringify(initialDesign),
    });
  };

  return (
    <>
      <h1>New Countertop Job</h1>
      {save.error && <p className="errors">{save.error.message}</p>}
      <form className="card form" onSubmit={handleSubmit}>
        <label>
          Customer Name
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="e.g. Rivera Kitchen"
            required
          />
        </label>
        <label>
          Material
          <select value={material} onChange={(e) => setMaterial(e.target.value)}>
            {MATERIALS.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} (${m.ratePerSqFt}/sq ft)
              </option>
            ))}
          </select>
        </label>
        <label>
          Starting Shape
          <select value={shapeType} onChange={(e) => setShapeType(e.target.value as ShapeType)}>
            {SHAPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label} — {s.desc}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="button" disabled={save.isPending}>
          {save.isPending ? 'Creating…' : 'Create & Draw Counter'}
        </button>
      </form>
    </>
  );
}
