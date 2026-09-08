import ts from 'typescript';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const violations = [];
const layers = {
  shared: new Set(['shared']),
  application: new Set(['shared', 'application']),
  src: new Set(['shared', 'src']),
  infrastructure: new Set(['shared', 'application', 'infrastructure']),
  cloudflare: new Set(['shared', 'application', 'cloudflare']),
};
async function inspect(directory, layer) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      await inspect(relative, layer);
      continue;
    }
    if (/\.(mjs|js)$/.test(relative)) {
      violations.push(
        `${relative}: runtime source must be TypeScript; generated JavaScript belongs in dist/`,
      );
    }
    if (!/\.(mts|ts)$/.test(relative) || relative.endsWith('.d.ts')) continue;
    const source = await readFile(path.join(root, relative), 'utf8');
    const tree = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true);
    const inspectNode = (node) => {
      // The only outward domain entry is the documented compatibility facade.
      const moduleNode =
        ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
          ? node.moduleSpecifier
          : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
            ? node.arguments[0]
            : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
              ? node.argument.literal
              : undefined;
      if (moduleNode && ts.isStringLiteral(moduleNode)) {
        const specifier = moduleNode.text;
        if (specifier.startsWith('.')) {
          const destination = path.posix
            .normalize(path.posix.join(directory, specifier))
            .split('/')[0];
          if (!layers[layer].has(destination) && relative !== 'shared/game-core.mts') {
            violations.push(`${relative}: ${layer} cannot depend on ${specifier}`);
          }
        } else if (layer === 'shared' || layer === 'application') {
          violations.push(
            `${relative}: platform dependency ${specifier} is outside the domain/application`,
          );
        }
      }
      if (
        ts.isIdentifier(node) &&
        ['document', 'window', 'localStorage', 'sessionStorage', 'process'].includes(node.text) &&
        ['shared', 'application'].includes(layer)
      ) {
        violations.push(`${relative}: browser/Node global ${node.text} belongs in an adapter`);
      }
      ts.forEachChild(node, inspectNode);
    };
    inspectNode(tree);
    if (/@ts-(?:nocheck|ignore)/.test(source))
      violations.push(`${relative}: suppressed compiler diagnostics`);
  }
}
for (const layer of Object.keys(layers)) await inspect(layer, layer);
if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    'Architecture boundaries passed: domain → application → host adapters; browser → domain.',
  );
