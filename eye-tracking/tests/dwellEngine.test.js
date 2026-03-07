const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const context = {
  console,
  globalThis: {},
};

context.globalThis = context;
vm.createContext(context);

for (const relativePath of [
  "extension/shared/config.js",
  "extension/content/dwellEngine.js",
]) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  vm.runInContext(source, context, { filename: relativePath });
}

const namespace = context.EyeGazeCapture;
const DwellEngine = namespace.content.DwellEngine;
const engine = new DwellEngine({
  dwellThresholdMs: 2000,
  cooldownMs: 3000,
  minimumConfidence: 0.35,
  anchorBoxSize: 200,
});

function sampleAt(timestamp, overrides = {}) {
  return {
    timestamp,
    point: overrides.point || { x: 300, y: 220 },
    valid: overrides.valid !== undefined ? overrides.valid : true,
    confidence: overrides.confidence !== undefined ? overrides.confidence : 1,
  };
}

let result = engine.update(sampleAt(0));
assert.equal(result.state, "TRACKING");
assert.equal(result.progress, 0);
assert.deepEqual(result.anchorBounds, { x: 200, y: 120, width: 200, height: 200 });

result = engine.update(sampleAt(1999, { point: { x: 320, y: 240 } }));
assert.equal(result.triggered, false);
assert.ok(result.progress > 0.99 && result.progress < 1);
assert.deepEqual(result.anchorBounds, { x: 200, y: 120, width: 200, height: 200 });

result = engine.update(sampleAt(2000, { point: { x: 330, y: 250 } }));
assert.equal(result.triggered, true);
assert.equal(result.dwellDurationMs, 2000);
assert.equal(result.roi.id, "gaze_anchor");
assert.deepEqual(result.roi.bounds, { x: 200, y: 120, width: 200, height: 200 });

result = engine.update(sampleAt(2500, { point: { x: 340, y: 260 } }));
assert.equal(result.state, "COOLDOWN");
assert.equal(result.triggered, false);

result = engine.update(sampleAt(5001, { point: { x: 650, y: 400 } }));
assert.equal(result.state, "TRACKING");
assert.equal(result.triggered, false);
assert.deepEqual(result.anchorBounds, { x: 550, y: 300, width: 200, height: 200 });

result = engine.update(sampleAt(7001, { point: { x: 640, y: 410 } }));
assert.equal(result.triggered, true);
assert.equal(result.dwellDurationMs, 2000);

result = engine.update(sampleAt(9000, { valid: false }));
assert.equal(result.state, "IDLE");
assert.equal(result.anchorBounds, null);

result = engine.update(sampleAt(9100, { confidence: 0.1 }));
assert.equal(result.state, "IDLE");
assert.equal(result.triggered, false);

console.log("dwellEngine tests passed");
