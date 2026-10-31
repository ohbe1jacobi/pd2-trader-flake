import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Adapt sbomnix's SPDX root to the submission action's documented convention.
// Source fetches/unversioned build artifacts have no package URL; do not let
// the action invent generic packages for them. Preserve paths through them.
export function prepareSpdx(input) {
  const sbom = structuredClone(input);
  const root = sbom.name;
  const packages = sbom.packages.filter(pkg => pkg.externalRefs?.some(ref =>
    ref.referenceCategory === 'PACKAGE-MANAGER' && ref.referenceType === 'purl' && ref.referenceLocator));
  const kept = new Set(packages.map(pkg => pkg.SPDXID));
  if (!kept.has(root)) throw new Error('Missing sbomnix root package');
  const children = new Map();
  for (const edge of sbom.relationships) {
    if (edge.relationshipType !== 'DEPENDS_ON') continue;
    if (!children.has(edge.spdxElementId)) children.set(edge.spdxElementId, new Set());
    children.get(edge.spdxElementId).add(edge.relatedSpdxElement);
  }
  const rename = id => id === root ? 'SPDXRef-RootPackage' : id;
  sbom.relationships = [{
    spdxElementId: 'SPDXRef-DOCUMENT', relationshipType: 'DESCRIBES', relatedSpdxElement: rename(root),
  }];
  for (const pkg of packages) {
    const dependencies = new Set();
    const visited = new Set();
    const walk = id => {
      if (visited.has(id)) return;
      visited.add(id);
      if (kept.has(id)) dependencies.add(id);
      else for (const child of children.get(id) ?? []) walk(child);
    };
    for (const child of children.get(pkg.SPDXID) ?? []) walk(child);
    for (const id of [...dependencies].sort()) {
      if (id !== pkg.SPDXID) sbom.relationships.push({
        spdxElementId: rename(pkg.SPDXID), relationshipType: 'DEPENDS_ON', relatedSpdxElement: rename(id),
      });
    }
  }
  sbom.packages = packages.map(pkg => ({
    ...pkg, SPDXID: rename(pkg.SPDXID),
    // sbomnix percent-encodes '+', but the pinned submission toolkit's
    // packageurl-js parser requires literal '+'. Preserve versionInfo.
    externalRefs: pkg.externalRefs.map(ref => ref.referenceType === 'purl'
      ? { ...ref, referenceLocator: ref.referenceLocator.replace(/%2B/gi, '+') } : ref),
  }));
  sbom.name = 'Nix package build dependency graph (x86_64-linux)';
  return sbom;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , input, output] = process.argv;
  if (!input || !output || process.argv.length !== 4) throw new Error('Usage: node prepare-nix-sbom.mjs INPUT OUTPUT');
  writeFileSync(output, `${JSON.stringify(prepareSpdx(JSON.parse(readFileSync(input, 'utf8'))), null, 2)}\n`);
}
