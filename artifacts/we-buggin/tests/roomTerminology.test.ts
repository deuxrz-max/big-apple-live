import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const ts: typeof import('typescript') = createRequire(resolve('package.json'))('typescript');
const oldTerm = /\buniversit(?:y|ies)\b/i;

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
}

test('app copy and server messages use room terminology, preserving internal contracts', () => {
  const findings: string[] = [];
  for (const path of [...files(resolve('src')), ...files(resolve('../api-server/src'))]) {
    if (!/\.tsx?$/.test(path) || /\.test\./.test(path)) continue;
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node: import('typescript').Node) {
      if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node)
        || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) {
        const text = node.text;
        if (oldTerm.test(text)) {
          let attribute: import('typescript').Node | undefined = node.parent;
          while (attribute && !ts.isJsxAttribute(attribute) && !ts.isStatement(attribute)) attribute = attribute.parent;
          const styleOrTestHook = attribute && ts.isJsxAttribute(attribute)
            && ['className', 'data-testid'].includes(attribute.name.getText(source));
          const internalPath = /^(\.{1,2}\/|\/account\/|university-covers\/)/.test(text);
          const stableHashPrefix = path.endsWith('/lib/community.ts') && text === 'university:';
          if (!styleOrTestHook && !internalPath && !stableHashPrefix) {
            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            findings.push(`${path}:${line}: ${text}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  for (const path of [...files(resolve('public')), resolve('index.html')]) {
    if (/\.(svg|html|json|webmanifest)$/.test(path) && oldTerm.test(readFileSync(path, 'utf8'))) findings.push(path);
  }
  assert.deepEqual(findings, []);
});

test('Following uses the requested empty-state sentence', () => {
  const source = readFileSync(resolve('src/social/PeoplePages.tsx'), 'utf8');
  assert.ok(source.includes('No one you follow is in a room right now. Check back soon.'));
});
