import { describe, it } from 'node:test';
import assert from 'node:assert';
import { loadGraph } from '../loader.ts';
import { resolve } from 'node:path';

const EXAMPLES = resolve(import.meta.dirname, '../../examples');

describe('loader', () => {
  it('loads simple example', () => {
    const graph = loadGraph(resolve(EXAMPLES, 'simple/hello.ges.yaml'));
    assert.strictEqual(graph.meta.name, 'hello');
    assert.strictEqual(graph.meta.entry, 'start');
    assert.deepStrictEqual(graph.meta.terminal, ['end']);
    assert.ok(graph.nodes['start']);
    assert.strictEqual(graph.edges.length, 2);
  });

  it('loads review-loop example', () => {
    const graph = loadGraph(resolve(EXAMPLES, 'review-loop/review-loop.ges.yaml'));
    assert.strictEqual(graph.meta.name, 'review-loop');
    assert.ok(graph.bindings?.['reviewer']);
    assert.strictEqual(Object.keys(graph.nodes).length, 3);
    assert.ok(graph.edges.some(e => e.from === 'fix' && e.to === 'review'));
  });

  it('loads odyssey-planex example', () => {
    const graph = loadGraph(resolve(EXAMPLES, 'odyssey-planex/odyssey-planex.ges.yaml'));
    assert.strictEqual(graph.meta.name, 'odyssey-planex');
    assert.strictEqual(Object.keys(graph.nodes).length, 7);
    assert.ok(graph.bindings?.['analyzer']);
    assert.ok(graph.bindings?.['reviewer']);
    assert.ok(graph.bindings?.['searcher']);
  });

  it('rejects invalid graph', () => {
    assert.throws(
      () => loadGraph(resolve(EXAMPLES, 'nonexistent.ges.yaml')),
      /not found/,
    );
  });
});
