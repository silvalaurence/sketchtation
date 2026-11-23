export function initialLayersForRoute(routeLayers, routeDrawings, route) {
  const layers = routeLayers.get(route);
  if (Array.isArray(layers) && layers.length > 0) return layers;

  return [{ name: "Sketch 1", strokes: routeDrawings.get(route) || [], visible: true }];
}

export function clearRouteDrawing(routeDrawings, routeLayers, route) {
  routeDrawings.delete(route);
  routeLayers.delete(route);
}

export function canDrawOnLayer(layer) {
  return Boolean(layer?.visible);
}
