// The pdf-parse root entry runs debug code when imported directly, so we
// import the library file — which ships no types. Minimal declaration here.
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: Record<string, unknown> | null;
    metadata: unknown;
    text: string;
    version: string;
  }
  function pdfParse(
    data: Buffer | Uint8Array,
    options?: Record<string, unknown>,
  ): Promise<PdfParseResult>;
  export default pdfParse;
}
