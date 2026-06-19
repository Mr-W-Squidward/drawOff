export type Tool = 'brush'| 'eraser';

export interface Stroke {
  type: 'brush' | 'eraser';
  colour: string;
  width: number;
  points: Array<{ x: number, y: number }>
};

export interface CanvasState {
  history: Stroke[];
  historyIndex: number;
  currentTool: 'brush' | 'eraser';
};
