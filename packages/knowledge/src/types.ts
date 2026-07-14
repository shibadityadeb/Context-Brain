/** A heading-delimited region of the parsed document. */
export interface DocumentSection {
  heading: string;
  /** Heading depth, 1 = top level. */
  level: number;
  /** Character offsets into the cleaned text. */
  startOffset: number;
  endOffset: number;
}

/** Metadata a parser could recover from the raw file. */
export interface ExtractedMetadata {
  title?: string;
  author?: string;
  creationDate?: string;
  language?: string;
  pageCount?: number;
  tableCount?: number;
  headings?: string[];
  keywords?: string[];
  [key: string]: unknown;
}

/** Uniform output of every parser. */
export interface ParsedDocument {
  /** Linear plain text (pre-clean; the pipeline cleans it afterwards). */
  text: string;
  sections: DocumentSection[];
  metadata: ExtractedMetadata;
}

export interface ParseContext {
  fileName: string;
  mimeType: string;
}

/** Pluggable parser contract — register implementations in parsers/index.ts. */
export interface DocumentParser {
  name: string;
  mimeTypes: string[];
  extensions: string[];
  parse(buffer: Buffer, context: ParseContext): Promise<ParsedDocument>;
}

export interface ChunkOptions {
  /** Target chunk size in tokens (approximate). */
  chunkSize: number;
  /** Tokens carried over from the previous chunk. */
  chunkOverlap: number;
  /** Never emit a chunk above this hard token ceiling. */
  maxTokens: number;
  /** Start a new chunk at section/heading boundaries. */
  respectSections: boolean;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  chunkSize: 400,
  chunkOverlap: 60,
  maxTokens: 512,
  respectSections: true,
};

export interface TextChunk {
  index: number;
  content: string;
  tokenCount: number;
  heading: string | null;
  section: string | null;
  startOffset: number;
  endOffset: number;
}
