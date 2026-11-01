import { sitePoint, type Point, type Region } from "./questTerritory";

/** Screen pixels per map unit: names stay readable instead of shrinking with the container. */
export const MAP_SCALE = 2;
/** Names are 12.5 screen pixels whatever the map's size. */
export const LABEL_SIZE = 12.5 / MAP_SCALE;
const CHAR_WIDTH = LABEL_SIZE * 0.58;
const LINE_HEIGHT = LABEL_SIZE * 1.3;
const LINE_CHARS = 18;
const MIN_CELLS = 4;

/** Up to two lines broken at spaces; a longer name ends in an ellipsis. */
function wrap(title: string): ReadonlyArray<string> {
  const lines: Array<string> = [];
  let line = "";
  for (const word of title.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= LINE_CHARS || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= 2) return lines.map((item) => clip(item));
  return [clip(lines[0]!), clip(`${lines[1]!} ${lines.slice(2).join(" ")}`, true)];
}

function clip(text: string, more = false) {
  return text.length > LINE_CHARS || more ? `${text.slice(0, LINE_CHARS - 1).trimEnd()}…` : text;
}

export interface PlacedLabel {
  readonly id: string;
  readonly lines: ReadonlyArray<string>;
  readonly at: Point;
  readonly width: number;
  readonly height: number;
  /** A scope drawn subdivided names itself; its parts carry their own names. */
  readonly parent: boolean;
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Names placed so no two overlap, larger and outer scopes first. A region whose name finds no free
 * spot stays unnamed on the map; hover, focus and the inspector still name it.
 */
export function placeLabels(regions: ReadonlyArray<Region>): ReadonlyArray<PlacedLabel> {
  const placed: Array<PlacedLabel & { box: Box }> = [];
  const ordered = regions.toSorted(
    (a, b) =>
      Number(b.expanded) - Number(a.expanded) ||
      a.depth - b.depth ||
      b.cells.length - a.cells.length,
  );
  for (const region of ordered) {
    // A small scope is named on hover and focus rather than by a plate covering its results.
    if (!region.expanded && region.cells.length < MIN_CELLS) continue;
    const lines = wrap(region.work.title);
    const width = Math.max(...lines.map((line) => line.length)) * CHAR_WIDTH + 6;
    const height = lines.length * LINE_HEIGHT + 3;
    const sites = region.cells.map(sitePoint);
    const mean = {
      x: sites.reduce((sum, site) => sum + site.x, 0) / sites.length,
      y: sites.reduce((sum, site) => sum + site.y, 0) / sites.length,
    };
    // A parent names itself along its top edge; a leaf as near its middle as space allows.
    const candidates = region.expanded
      ? sites
          .toSorted((a, b) => a.y - b.y || Math.abs(a.x - mean.x) - Math.abs(b.x - mean.x))
          .slice(0, 6)
          .map((site) => ({ x: site.x, y: site.y - 2 }))
      : sites
          .toSorted(
            (a, b) =>
              Math.hypot(a.x - mean.x, a.y - mean.y) - Math.hypot(b.x - mean.x, b.y - mean.y),
          )
          .slice(0, 8);
    for (const at of candidates) {
      const box = { x: at.x - width / 2, y: at.y - height / 2, width, height };
      if (placed.some((other) => overlaps(other.box, box))) continue;
      placed.push({
        id: region.work.id,
        lines,
        at,
        width,
        height,
        parent: region.expanded,
        box,
      });
      break;
    }
  }
  return placed.map(({ box: _box, ...label }) => label);
}
