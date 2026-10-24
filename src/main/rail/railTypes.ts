/** The two operators the connector covers. */
export type RailMode = 'thsr' | 'tra';

/**
 * A station keyed by operator: THSR and TRA number their stations independently and the numbers
 * collide (both have a `1000`, Taipei), so a bare id is never enough.
 */
export type RailNode = `${RailMode}:${string}`;

/** One call at a station, in minutes after 00:00 of the train's service day (past 1440 after midnight). */
export interface RailStop {
  node: RailNode;
  arr: number;
  dep: number;
}

export interface RailTrain {
  mode: RailMode;
  no: string;
  /** Category the way a rider says it, in Chinese; `typeEn` is the English name. */
  type: string;
  typeEn: string;
  stops: RailStop[];
  note?: string;
  /**
   * Set on a train of an earlier service day whose stops were moved onto the day asked (still
   * running after midnight): the day it started, which is the run TRA's train page reports on.
   */
  serviceDay?: string;
}

/** One train ridden from one station to another. */
export interface Leg {
  train: RailTrain;
  from: RailNode;
  to: RailNode;
  dep: number;
  arr: number;
}

export interface Journey {
  legs: Leg[];
  dep: number;
  arr: number;
  transfers: number;
}

export type TripSort = 'earliest_arrival' | 'shortest' | 'earliest_departure';
export type TimeIs = 'depart' | 'arrive';

export function railNode(mode: RailMode, id: string): RailNode {
  return `${mode}:${id}`;
}

export function nodeMode(node: RailNode): RailMode {
  return node.startsWith('thsr:') ? 'thsr' : 'tra';
}

export function nodeId(node: RailNode): string {
  return node.slice(node.indexOf(':') + 1);
}
