/**
 * What to call a street segment that OpenStreetMap never named.
 *
 * Only 791 of Madinah's 18,320 ways carry a name tag, so ~88% of ranked
 * segments have no name at all. Rendering «شارع بلا اسم» 26,727 times is
 * accurate and useless: a crew sent to one has been told nothing.
 *
 * A name cannot be invented — someone would be dispatched on it. What is
 * derivable is position relative to a road that IS named, computed from the OSM
 * geometry by research/derive_segment_labels.py and shipped as `nd: [roadIdx,
 * metres]` against a `roadNames` lookup on the collection.
 *
 * Two registers, because the confidence genuinely differs:
 *   امتداد X       within 25 m — almost certainly the same corridor
 *   قرب X — 210 م  further off; a bearing, not an address
 *
 * `derived` is returned separately so the UI can style it as the weaker thing
 * it is. A derived label must never be presented as the street's name.
 */
export function segmentLabel(props, roadNames) {
  if (props?.name) return { text: props.name, derived: false };

  const nd = props?.nd;
  if (Array.isArray(nd) && roadNames?.[nd[0]]) {
    const [i, m] = nd;
    return {
      text: m <= 25 ? `امتداد ${roadNames[i]}` : `قرب ${roadNames[i]} — ${m} م`,
      derived: true,
      near: roadNames[i],
      distM: m,
    };
  }
  // No named road within 600 m. Saying «قرب» about something a kilometre away
  // would mislead, so this stays honest and leans on the district instead.
  return { text: 'شارع بلا اسم', derived: false, unlocated: true };
}
