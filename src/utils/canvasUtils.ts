import type { Stroke } from '../types/canvas.types';

export const CANVAS_WIDTH = 1000;
export const CANVAS_HEIGHT = 750;

export function canvasPoint(clientX: number, clientY: number, rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>) {
  return {
    x: Math.max(0, Math.min(CANVAS_WIDTH, (clientX - rect.left) * CANVAS_WIDTH / rect.width)),
    y: Math.max(0, Math.min(CANVAS_HEIGHT, (clientY - rect.top) * CANVAS_HEIGHT / rect.height)),
  };
}

export function redrawCanvas(canvas: HTMLCanvasElement, strokes: Stroke[], upToIndex: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.resetTransform();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(canvas.width / CANVAS_WIDTH, canvas.height / CANVAS_HEIGHT);
  for (const stroke of strokes.slice(0, upToIndex + 1)) {
    const first = stroke.points[0];
    if (!first) continue;
    ctx.globalCompositeOperation = stroke.type === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = ctx.fillStyle = stroke.colour;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    if (stroke.points.length === 1) {
      ctx.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(first.x, first.y);
      for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}
