declare module "clipper-lib" {
  export interface IntPoint {
    X: number;
    Y: number;
  }

  export type Path = IntPoint[];
  export type Paths = Path[];

  export interface ExPolygon {
    outer: Path;
    holes: Path[];
  }

  export interface PolyNode {
    Contour(): Path;
    Childs(): PolyNode[];
    IsHole(): boolean;
  }

  export interface PolyTree extends PolyNode {}

  export class Clipper {
    constructor(initOptions?: number);
    AddPaths(paths: Paths, polyType: number, closed: boolean): void;
    AddPath(path: Path, polyType: number, closed: boolean): void;
    Execute(
      clipType: number,
      solution: PolyTree,
      subjFillType: number,
      clipFillType: number,
    ): boolean;
    static PolyTreeToPaths(tree: PolyTree): Paths;
    static CleanPolygons(paths: Paths, distance: number): Paths;
  }

  export class ClipperOffset {
    constructor(miterLimit?: number, arcTolerance?: number);
    AddPaths(paths: Paths, joinType: number, endType: number): void;
    Execute(solution: Paths, delta: number): void;
  }

  export interface ClipperLib {
    Clipper: typeof Clipper;
    ClipperOffset: typeof ClipperOffset;
    PolyTree: new () => PolyTree;
    Paths: new () => Paths;
    ClipType: { ctUnion: number; ctDifference: number };
    PolyType: { ptSubject: number; ptClip: number };
    PolyFillType: { pftNonZero: number };
    JoinType: { jtRound: number };
    EndType: { etClosedPolygon: number };
    JS: {
      PolyTreeToExPolygons(tree: PolyTree): ExPolygon[];
    };
  }

  const ClipperLib: ClipperLib;
  export default ClipperLib;
}
