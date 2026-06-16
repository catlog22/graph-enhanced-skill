import { describe, it } from 'node:test';
import assert from 'node:assert';
import { loadGraph } from '../loader.ts';
import { parseGesMarkdown } from '../md-loader.ts';
import { resolve } from 'node:path';

const EXAMPLES = resolve(import.meta.dirname, '../../examples');

describe('md-loader', () => {
  it('loads simple example', () => {
    const graph = loadGraph(resolve(EXAMPLES, 'simple/hello.ges.md'));
    assert.strictEqual(graph.schema, 'ges/2.0');
    assert.strictEqual(graph.meta.name, 'hello');
    assert.strictEqual(graph.meta.entry, 'start');
    assert.deepStrictEqual(graph.meta.terminal, ['end']);
    assert.ok(graph.nodes['start']);
    assert.strictEqual(graph.edges.length, 2);
    assert.strictEqual(graph.nodes['start'].actions[0].prompt, '向用户打招呼并询问需求');
  });

  it('loads review-loop example', () => {
    const graph = loadGraph(resolve(EXAMPLES, 'review-loop/review-loop.ges.md'));
    assert.strictEqual(graph.meta.name, 'review-loop');
    assert.ok(graph.bindings?.['reviewer']);
    assert.strictEqual(Object.keys(graph.nodes).length, 4);
    assert.ok(graph.edges.some(e => e.from === 'fix' && e.to === 'review'));
    assert.ok(graph.nodes['review'].actions[0].run);
  });

  it('loads odyssey-planex example', () => {
    const graph = loadGraph(resolve(EXAMPLES, 'odyssey-planex/odyssey-planex.ges.md'));
    assert.strictEqual(graph.meta.name, 'odyssey-planex');
    assert.ok(graph.bindings?.['analyzer']);
    assert.ok(graph.bindings?.['reviewer']);
    assert.ok(graph.bindings?.['searcher']);
    assert.strictEqual(graph.nodes['intake'].actions.length, 3);
    assert.ok(graph.nodes['intake'].actions[2].optional);
  });

  it('loads parallel-review with fork/join/goal', () => {
    const graph = loadGraph(resolve(EXAMPLES, 'parallel-review/parallel-review.ges.md'));
    assert.strictEqual(graph.meta.name, 'parallel-review');
    assert.strictEqual(graph.meta.goal, 'lint.pass && tests.pass && review.pass');

    const forkEdge = graph.edges.find(e => e.from === 'intake');
    assert.ok(Array.isArray(forkEdge?.to));
    assert.deepStrictEqual((forkEdge?.to as string[]).sort(), ['lint', 'review', 'tests']);

    const joinEdge = graph.edges.find(e => Array.isArray(e.from));
    assert.ok(joinEdge);
    assert.strictEqual(joinEdge?.to, 'decide');
  });

  it('loads handoff example with meta.output', () => {
    const graph = loadGraph(resolve(EXAMPLES, 'handoff/build.ges.md'));
    assert.deepStrictEqual(graph.meta.output, ['artifact_path', 'test_passed', 'version']);
    const handoffEdge = graph.edges.find(e => e.handoff);
    assert.strictEqual(handoffEdge?.handoff, './deploy.ges.md');
  });

  it('loads deploy example with meta.input', () => {
    const graph = loadGraph(resolve(EXAMPLES, 'handoff/deploy.ges.md'));
    assert.ok(graph.meta.input);
    assert.deepStrictEqual(graph.meta.input?.required, ['artifact_path']);
  });

  it('terminal nodes have empty actions', () => {
    const graph = loadGraph(resolve(EXAMPLES, 'simple/hello.ges.md'));
    assert.strictEqual(graph.nodes['end'].actions.length, 0);
  });

  it('rejects missing file', () => {
    assert.throws(
      () => loadGraph(resolve(EXAMPLES, 'nonexistent.ges.md')),
      /not found/,
    );
  });

  it('rejects missing graph block', () => {
    assert.throws(
      () => parseGesMarkdown('---\nschema: ges/2.0\nname: test\n---\nno graph here'),
      /missing <graph>/i,
    );
  });

  it('rejects unknown prompt ref', () => {
    const src = `---
schema: ges/2.0
name: test
---

<graph>
<node id="start" entry />
<node id="end" terminal />
<edge from="start" to="end" />
</graph>

## [unknown_node]

Some prompt
`;
    assert.throws(
      () => parseGesMarkdown(src),
      /unknown node/,
    );
  });
});
