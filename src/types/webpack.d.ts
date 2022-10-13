import type { Chunk, Compilation } from "webpack";

export type ChunkGroup = Compilation["chunkGroups"] extends (infer G)[] ? G : never;
export type ChunkId = Exclude<Chunk["id"], null>;
