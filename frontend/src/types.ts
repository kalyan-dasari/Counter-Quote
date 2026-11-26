export type EdgeKind = 'wall' | 'finished';

export type CutoutType = 'undermount_sink' | 'dropin_sink' | 'cooktop' | 'faucet';

export type ShapeType = 'rectangle' | 'l-shape' | 'u-shape' | 'custom';

export interface Point {
  x: number;
  y: number;
}

export interface CounterEdge {
  kind: EdgeKind;
  backsplash: boolean;
}

export interface Cutout {
  id: string;
  type: CutoutType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface CounterDesign {
  points: Point[];
  edges: CounterEdge[];
  cutouts: Cutout[];
}

export interface Job {
  id: number;
  customerName: string;
  material: string;
  thickness: string;
  edgeProfile: string;
  cornerFinish: string;
  includeTemplating: boolean;
  includeRemoval: boolean;
  shapeType: ShapeType | string;
  designJson: string;
  areaSqFt: number;
  finishedEdgeLinFt: number;
  backsplashLinFt: number;
  insideCorners: number;
  outsideFinishedCorners: number;
  angledCorners: number;
  cutoutCount: number;
  totalPrice: number;
  notes: string;
  createdDate: string;
}

export type NewJob = Pick<Job, 'customerName' | 'material' | 'shapeType' | 'designJson'>;
