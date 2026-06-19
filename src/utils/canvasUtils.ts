import type { Stroke } from '../types/canvas.types';

function redrawCanvas(canvas: HTMLCanvasElement, strokes: Stroke[], upToIndex: number) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return

    // CLEAR
    ctx.fillStyle = canvas.id === 'canvasLeft' ? '#123123' : "#521312"
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // REDRAW / REDO
    for (let i = 0; i <= upToIndex && i < strokes.length; i++) {
      const stroke = strokes[i]
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';

      if (stroke.type === 'brush') {
        ctx.globalCompositeOperation = 'source-over'
        ctx.strokeStyle = stroke.colour;
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        
        for (let j = 0; j < stroke.points.length; j++) {
          ctx.lineTo(stroke.points[j].x, stroke.points[j].y)
        };

        ctx.stroke();
      } 
      
      else if (stroke.type === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.strokeStyle = canvas.id === 'canvasLeft' ? '#123123' : '#521312'
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        
        for (let k = 0; k < stroke.points.length; k++) {
          ctx.lineTo(stroke.points[k].x, stroke.points[k].y)
        };
    
        ctx.stroke();
      }

    ctx.globalCompositeOperation = 'source-over';
    }
}

export { redrawCanvas };