export interface Point {
  x: number; // Normalized 0-1 relative to canvas width
  y: number; // Normalized 0-1 relative to canvas height
}

export interface Path {
  points: Point[];
  color: string;
  lineWidth: number;
}

export interface DrawingData {
  paths: Path[];
  canvasWidth: number;
  canvasHeight: number;
}

export interface AutoEntry {
  id: number;
  climb: boolean;
  drawing: DrawingData | null;
  description?: string;
}
