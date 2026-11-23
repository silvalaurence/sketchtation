import assert from "node:assert/strict";
import test from "node:test";
import { canDrawOnLayer, clearRouteDrawing, initialLayersForRoute } from "../site/editor/layer-drafts.js";

test("a successful send clears layered and legacy route drafts", () => {
  const route = "/projects/sketchtation";
  const routeDrawings = new Map([[route, [{ points: [{ x: 10, y: 12 }] }]]]);
  const routeLayers = new Map([
    [route, [{ name: "Notes", visible: true, strokes: [{ points: [{ x: 10, y: 12 }] }] }]],
  ]);

  clearRouteDrawing(routeDrawings, routeLayers, route);

  assert.equal(routeDrawings.has(route), false);
  assert.equal(routeLayers.has(route), false);
  assert.deepEqual(initialLayersForRoute(routeLayers, routeDrawings, route), [
    { name: "Sketch 1", strokes: [], visible: true },
  ]);
});

test("older route drawings still load as a default layer", () => {
  const route = "/projects/legacy";
  const strokes = [{ tool: "pen", points: [{ x: 4, y: 5 }] }];
  const layers = initialLayersForRoute(new Map(), new Map([[route, strokes]]), route);

  assert.deepEqual(layers, [{ name: "Sketch 1", strokes, visible: true }]);
});

test("hidden layers cannot be drawn on", () => {
  assert.equal(canDrawOnLayer({ visible: true }), true);
  assert.equal(canDrawOnLayer({ visible: false }), false);
  assert.equal(canDrawOnLayer(undefined), false);
});
