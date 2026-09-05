import assert from 'node:assert/strict';
import { canvasPoint, redrawCanvas } from '../src/utils/canvasUtils.ts';

for (const width of [320, 768, 1200]) {
  assert.deepEqual(canvasPoint(10 + width / 2, 20 + width * .75 / 2, { left: 10, top: 20, width, height: width * .75 }), { x: 500, y: 375 });
}
assert.deepEqual(canvasPoint(-10, 900, { left: 0, top: 0, width: 1000, height: 750 }), { x: 0, y: 750 });
const calls = [];
const ctx = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]), set: (target, name, value) => { calls.push([name, value]); target[name] = value; return true; } });
redrawCanvas({ width: 640, height: 480, getContext: () => ctx }, [{ type: 'eraser', colour: '#000000', width: 10, points: [{ x: 50, y: 50 }] }], 0);
assert.ok(calls.some(call => call[0] === 'clearRect'));
assert.ok(calls.some(call => call[0] === 'arc'));
assert.ok(calls.some(call => call[0] === 'globalCompositeOperation' && call[1] === 'destination-out'));
assert.deepEqual(calls.at(-1), ['globalCompositeOperation', 'source-over']);
console.log('PASS: consistent mobile/desktop coordinates, bounds, tap dots, eraser reset');
