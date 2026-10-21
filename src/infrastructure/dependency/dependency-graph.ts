import type { DependencyEdge, EvidenceBackedClaim } from '../../domain/index.js';

export interface DependencyLookup {
  /** Direct imports/references outgoing from a file */
  readonly outgoingByPath: ReadonlyMap<string, readonly string[]>;
  /** Direct incoming dependents (files that import the given file) */
  readonly incomingByPath: ReadonlyMap<string, readonly string[]>;
}

/**
 * Builds fast outgoing and incoming adjacency maps from verified/inferred DependencyEdge claims.
 */
export function buildDependencyLookup(
  edges: readonly EvidenceBackedClaim<DependencyEdge>[],
  indexedPaths: ReadonlySet<string>
): DependencyLookup {
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();

  for (const claim of edges) {
    const { fromPathOrModule, toPathOrModule } = claim.value;
    if (!indexedPaths.has(fromPathOrModule) || !indexedPaths.has(toPathOrModule)) {
      continue;
    }
    if (fromPathOrModule === toPathOrModule) {
      continue;
    }

    let outSet = outgoing.get(fromPathOrModule);
    if (!outSet) {
      outSet = new Set<string>();
      outgoing.set(fromPathOrModule, outSet);
    }
    outSet.add(toPathOrModule);

    let inSet = incoming.get(toPathOrModule);
    if (!inSet) {
      inSet = new Set<string>();
      incoming.set(toPathOrModule, inSet);
    }
    inSet.add(fromPathOrModule);
  }

  const outgoingByPath = new Map<string, readonly string[]>();
  for (const [k, v] of outgoing.entries()) {
    outgoingByPath.set(k, Array.from(v).sort());
  }

  const incomingByPath = new Map<string, readonly string[]>();
  for (const [k, v] of incoming.entries()) {
    incomingByPath.set(k, Array.from(v).sort());
  }

  return { outgoingByPath, incomingByPath };
}
