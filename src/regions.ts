/**
 * The download catalogue: a tree of places (world > country > region).
 * Only leaves carry a PMTiles archive; inner nodes are for navigation.
 * `outline` is a small GeoJSON file drawn on the selection map.
 */
export interface RegionNode {
  id: string;
  name: string;
  /** GeoJSON (relative to regions.json) used to draw and pick this node. */
  outline?: string;
  /** GeoJSON drawn underneath while this node is open (e.g. a country's provinces). */
  backdrop?: string;
  /** Camera for the selection map when this node is open. */
  bbox?: [number, number, number, number];
  children?: RegionNode[];
  pmtiles?: {
    /** Relative to regions.json, or absolute. */
    url: string;
    /** Exact archive size, used for the quota check and to verify the download. */
    bytes: number;
    maxzoom: number;
    /** OSM data date of the archive, shown to the user. */
    osmDate?: string;
  };
}

/** The chain of nodes from the root down to the node with `id`, or null. */
export function findPath(root: RegionNode, id: string): RegionNode[] | null {
  if (root.id === id) return [root];
  for (const child of root.children ?? []) {
    const rest = findPath(child, id);
    if (rest) return [root, ...rest];
  }
  return null;
}

/** All leaves that have an archive. */
export function leaves(root: RegionNode): RegionNode[] {
  if (root.pmtiles) return [root];
  return (root.children ?? []).flatMap(leaves);
}

/**
 * The file name an archive is stored under in OPFS.
 * The service worker only sees request URLs, so the name must be derivable
 * from the URL alone; the last path segment carries the region and the date.
 */
export function opfsName(url: string): string {
  const path = new URL(url, "http://x/").pathname;
  return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
}

/** OPFS directory holding finished archives (and `.part` files while downloading). */
export const OPFS_DIR = "regions";
export const PART_SUFFIX = ".part";
