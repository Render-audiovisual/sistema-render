import path from 'node:path';

// Reference implementations stay in the repository, never in operational chunks.
// Deliberately exact: MoodboardPreview and verified shared code remain allowed.
export const parallelEntrypoints = Object.freeze([
  'src/pages/DesignPreview.jsx',
  'src/pages/SandboxWorkspace.jsx',
  'src/pages/PreviewCommentsProposal.jsx',
  'src/pages/PreviewLocalProfileContext.jsx',
  'src/components/LocalDesignShell.jsx',
]);

export function parallelModulesInBundle(bundle, root) {
  const prefix = path.resolve(root).replaceAll('\\', '/') + '/';
  const found = new Set();
  for (const chunk of Object.values(bundle)) {
    if (chunk.type !== 'chunk') continue;
    for (const id of Object.keys(chunk.modules)) {
      const clean = id.replace(/^\0/, '').replaceAll('\\', '/').split(/[?#]/, 1)[0];
      if (!clean.startsWith(prefix)) continue;
      const relative = clean.slice(prefix.length);
      if (parallelEntrypoints.includes(relative)) found.add(relative);
    }
  }
  return [...found].sort();
}

export function canonicalBundleGuard() {
  let root;
  return {
    name: 'render-canonical-bundle-guard',
    apply: 'build',
    configResolved(config) { root = config.root; },
    generateBundle(_options, bundle) {
      const forbidden = parallelModulesInBundle(bundle, root);
      if (forbidden.length) this.error(`Render release includes parallel entrypoints: ${forbidden.join(', ')}`);
    },
  };
}
