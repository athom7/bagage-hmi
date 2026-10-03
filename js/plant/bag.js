// A bag travelling through the plant.

export function createBag(seq, spec, counterId, time) {
  return {
    id: 'B' + String(seq).padStart(4, '0'),
    tag: '0220' + String(458100 + seq).padStart(6, '0'), // 10-digit bag tag (IATA style)
    ...spec,
    source: counterId,
    belt: counterId,
    pos: spec.len / 2 + 2,
    t0: time,
    status: 'onbelt', // onbelt | delivered | rejected
    misrouted: false,
    scanned: false,
    history: [counterId],
  };
}

// Planned route as a list of place ids (see PLACE_NAMES in hmi/components.js).
export function plannedRoute(bag) {
  if (bag.gate > 0) return [bag.source, 'MAIN', 'DIV' + bag.gate, 'G' + bag.gate];
  return [bag.source, 'MAIN', 'REJ'];
}
