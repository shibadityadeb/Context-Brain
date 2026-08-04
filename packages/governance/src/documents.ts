import { DOCUMENT_SPECS, LAWS } from './registry.js';
import type { ApplicableLaw, DocumentSpec, DocumentType } from './types.js';

/**
 * Resolve the spec for a document to generate, annotated with the applicable
 * laws that make it relevant — so the drafter (LLM) can ground and cite it. The
 * package never calls an LLM; it only produces the structured spec.
 */
export function documentSpecFor(type: DocumentType, applicable: ApplicableLaw[]): DocumentSpec {
  const base = DOCUMENT_SPECS[type];
  const applicableIds = new Set(applicable.map((a) => a.lawId));
  const drivenBy = LAWS.filter(
    (l) => applicableIds.has(l.id) && l.requiredDocuments.includes(type),
  ).map((l) => l.shortName);
  return { ...base, drivenBy };
}

/** The distinct document types any applicable law requires. */
export function requiredDocumentTypes(applicable: ApplicableLaw[]): DocumentType[] {
  const applicableIds = new Set(applicable.map((a) => a.lawId));
  const types = new Set<DocumentType>();
  for (const law of LAWS) {
    if (!applicableIds.has(law.id)) continue;
    for (const d of law.requiredDocuments) types.add(d);
  }
  return [...types];
}
