/**
 * DO NOT DELETE — this stub is load-bearing for `bun run build:binary`.
 *
 * Ink guards its React DevTools bridge behind `process.env.DEV === 'true'`, but reaches it
 * via `await import('./devtools.js')` (ink/build/reconciler.js), and that module's top-level
 * `import devtools from 'react-devtools-core'` is resolved STATICALLY by Bun's bundler —
 * regardless of the dead branch. Without something to resolve, `bun build --compile` fails:
 *
 *   error: Could not resolve: "react-devtools-core"
 *
 * Neither escape hatch works:
 *   --external react-devtools-core   compiles, then dies at binary startup with
 *                                    "Cannot find package ... from '/$bunfs/root/'"
 *   --define process.env.DEV='"false"'  no effect; resolution happens before dead-code removal.
 *
 * So we satisfy the resolver with an inert module. The shipped binary never sets DEV=true,
 * meaning nothing here is ever called. Real devtools remain available in development by
 * installing the actual package.
 *
 * Same spirit as packages/server/scripts/ensure-type-stub.ts.
 */
export default {
  initialize() {},
  connectToDevTools() {},
}
