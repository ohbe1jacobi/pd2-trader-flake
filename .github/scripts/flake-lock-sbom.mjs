import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Nix package scanning and GitHub submission belong to sbomnix and the SPDX
// submission action. This adapter only describes the committed flake inputs.
export function lockToSpdx(lock) {
  if (lock.version !== 7 || !lock.nodes?.[lock.root]) throw new Error('Expected a version 7 flake lock');
  const { nodes, root } = lock;
  const resolve = (ref, trail = new Set()) => {
    if (typeof ref === 'string' && nodes[ref]) return ref;
    if (!Array.isArray(ref)) throw new Error('Missing lock node or input');
    const key = JSON.stringify(ref);
    if (trail.has(key)) throw new Error('Cyclic follows input');
    const next = new Set([...trail, key]);
    return ref.reduce((node, name) => resolve(nodes[node]?.inputs?.[name], next), root);
  };
  const seen = new Set();
  const edges = [];
  const visit = node => {
    if (seen.has(node)) return;
    seen.add(node);
    for (const [, ref] of Object.entries(nodes[node].inputs ?? {}).sort()) {
      const dependency = resolve(ref);
      edges.push([node, dependency]);
      visit(dependency);
    }
  };
  visit(root);
  const digest = createHash('sha256').update(JSON.stringify(lock)).digest('hex');
  const id = node => node === root ? 'SPDXRef-RootPackage' : `SPDXRef-${Buffer.from(node).toString('hex')}`;
  const packages = [...seen].sort().map(node => {
    const pkg = {
      SPDXID: id(node), name: 'flake-inputs', versionInfo: digest, downloadLocation: 'NOASSERTION',
      filesAnalyzed: false,
    };
    if (node === root) return pkg;
    const pin = nodes[node].locked;
    if (pin?.type !== 'github' || !/^[a-f0-9]{40}$/.test(pin.rev)
      || !/^[\w.-]+$/.test(pin.owner) || !/^[\w.-]+$/.test(pin.repo)) {
      throw new Error(`Unsupported or unpinned flake input: ${node}; extend the adapter explicitly`);
    }
    return {
      ...pkg, name: `${pin.owner}/${pin.repo}`, versionInfo: pin.rev,
      downloadLocation: `https://github.com/${pin.owner}/${pin.repo}/archive/${pin.rev}.tar.gz`,
      externalRefs: [{
        referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl',
        referenceLocator: `pkg:github/${pin.owner}/${pin.repo}@${pin.rev}`,
      }],
    };
  });
  return {
    spdxVersion: 'SPDX-2.3', dataLicense: 'CC0-1.0', SPDXID: 'SPDXRef-DOCUMENT',
    name: 'Locked Nix flake inputs',
    documentNamespace: `https://spdx.org/spdxdocs/flake-lock-${digest}`,
    creationInfo: {
      creators: ['Tool: pd2-trader-flake-lock-adapter'],
      created: new Date(Math.max(0, ...[...seen].map(node => nodes[node].locked?.lastModified ?? 0)) * 1000).toISOString(),
    },
    packages,
    relationships: [
      { spdxElementId: 'SPDXRef-DOCUMENT', relationshipType: 'DESCRIBES', relatedSpdxElement: id(root) },
      ...edges.map(([from, to]) => ({
        spdxElementId: id(from), relationshipType: 'DEPENDS_ON', relatedSpdxElement: id(to),
      })),
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , input, output] = process.argv;
  if (!input || !output || process.argv.length !== 4) throw new Error('Usage: node flake-lock-sbom.mjs INPUT OUTPUT');
  writeFileSync(output, `${JSON.stringify(lockToSpdx(JSON.parse(readFileSync(input, 'utf8'))), null, 2)}\n`);
}
