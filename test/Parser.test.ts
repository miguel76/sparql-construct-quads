import { forEveryNodeType } from '@traqula/core';
import { Parser as Parser12 } from '@traqula/parser-sparql-1-2';
import { AstFactory, AstTransformer, astKnownKeysAllowlist, lex as l12 } from '@traqula/rules-sparql-1-2';
import type * as T12 from '@traqula/rules-sparql-1-2';
import { negativeTest, positiveTest } from '@traqula/test-utils';
import { beforeEach, describe, it } from 'vitest';
import type { QueryConstruct } from '../lib/index.js';
import { constructQuadsParserBuilder, Parser } from '../lib/index.js';
import { toConstructQuadsAst } from './upstreamAst.js';

describe('a SPARQL 1.2 parser with quads in CONSTRUCT templates', () => {
  const astFactory = new AstFactory({ tracksSourceLocation: false });
  const sourceTrackingAstFactory = new AstFactory();
  const sourceTrackingParser = new Parser({
    defaultContext: { astFactory: sourceTrackingAstFactory },
    lexerConfig: { positionTracking: 'full' },
  });
  // Only visits the keys the allowlist allows, so validation must work with it too
  const knownKeysTransformer = new AstTransformer({ visitChildren: () => {} }, astKnownKeysAllowlist);
  const parser = new Parser({ defaultContext: { astFactory, astTransformer: knownKeysTransformer }});
  // The upstream parser serves as oracle: the quads of `INSERT { ... }` are parsed like a template
  const parser12 = new Parser12({ defaultContext: { astFactory }});
  const context = { prefixes: { ex: 'http://example.org/' }};

  beforeEach(() => {
    astFactory.resetBlankNodeCounter();
    sourceTrackingAstFactory.resetBlankNodeCounter();
  });

  function visitedNodes(transformer: AstTransformer, ast: unknown): Set<object> {
    const visited = new Set<object>();
    transformer.visitNode(<object> ast, forEveryNodeType({ visitor: (node: object) => {
      visited.add(node);
    } }));
    return visited;
  }

  function parseConstruct(query: string): QueryConstruct {
    astFactory.resetBlankNodeCounter();
    const ast = parser.parse(query, context);
    if (!astFactory.isQueryConstruct(ast)) {
      throw new Error('Expected a CONSTRUCT query');
    }
    return <QueryConstruct> ast;
  }

  function insertQuads(quads: string): T12.Quads[] {
    astFactory.resetBlankNodeCounter();
    const update = <T12.Update> parser12.parse(`INSERT { ${quads} } WHERE {}`, context);
    return (<T12.UpdateOperationModify> update.updates[0].operation).insert;
  }

  function wherePatterns(patterns: string): T12.Pattern[] {
    astFactory.resetBlankNodeCounter();
    return (<T12.QuerySelect> parser12.parse(`SELECT * WHERE { ${patterns} }`, context)).where.patterns;
  }

  it('passes chevrotain validation', () => {
    constructQuadsParserBuilder.build({
      tokenVocabulary: l12.sparql12LexerBuilder.tokenVocabulary,
      lexerConfig: {
        skipValidations: false,
        ensureOptimizations: true,
      },
      parserConfig: {
        skipValidations: false,
      },
    });
  });

  describe('quads in CONSTRUCT templates', () => {
    const templates: Record<string, string> = {
      'only triples': 'ex:s ex:p ex:o . ?s ?p ?o',
      'an empty template': '',
      'a single named graph': 'GRAPH ex:g { ?s ?p ?o }',
      'a graph variable': 'GRAPH ?g { ?s ?p ?o }',
      'an empty graph block': 'GRAPH ?g { }',
      'triples before and after graphs': `?s a ex:Thing .
        GRAPH ex:g1 { ?s ex:p ?o } .
        GRAPH ?g { ?s ex:q ?o ; ex:r [ ex:t 1 ] }
        ?o a ex:Other`,
      'consecutive graph blocks without dots': 'GRAPH ex:g1 { ?s ?p ?o } GRAPH ex:g2 { ?s ?p ?o }',
      'a blank node shared across graphs': '_:b ex:p ?o . GRAPH ex:g { _:b ex:q ?o }',
      'collections': 'GRAPH ?g { ( 1 ?x ) ex:p ?o }',
      'SPARQL 1.2 reified triples and annotations': 'GRAPH ?g { ?s ex:p ?o {| ex:since 2024 |} . << ?s ex:p ?o >> ex:q 1 }',
      'SPARQL 1.2 triple terms': 'GRAPH ex:g { ?s ex:p <<( ?s ex:p ?o )>> }',
    };

    for (const [ name, template ] of Object.entries(templates)) {
      it(`parses ${name} like the quads of INSERT`, ({ expect }) => {
        const ast = parseConstruct(`CONSTRUCT { ${template} } WHERE { GRAPH ?g { ?s ?p ?o } }`);
        expect(ast.template).toEqual(insertQuads(template));
        expect(ast.where.patterns).toEqual(wherePatterns('GRAPH ?g { ?s ?p ?o }'));
      });
    }

    it('keeps the order and kind of the template elements', ({ expect }) => {
      const ast = parseConstruct(`CONSTRUCT {
        ?s ?p ?o .
        GRAPH ex:g { ?s ?p ?o } .
        GRAPH ?g { ?s ?p ?o }
        ?a ?b ?c
      } WHERE { GRAPH ?g { ?s ?p ?o } ?a ?b ?c }`);
      expect(ast.template.map(quads => quads.type)).toEqual([ 'pattern', 'graph', 'graph', 'pattern' ]);
      const [ , named, variable ] = <T12.GraphQuads[]> ast.template;
      expect(named.graph).toMatchObject({ type: 'term', subType: 'namedNode', prefix: 'ex', value: 'g' });
      expect(variable.graph).toMatchObject({ type: 'term', subType: 'variable', value: 'g' });
    });

    it('accepts the short form CONSTRUCT WHERE, with the template as WHERE clause', ({ expect }) => {
      const quads = '?s ?p ?o . GRAPH ?g { ?s ex:p ?x } GRAPH ex:g { ?x ?q ?y }';
      const ast = parseConstruct(`CONSTRUCT WHERE { ${quads} }`);
      expect(ast.template).toEqual(insertQuads(quads));
      expect(ast.where.patterns).toEqual(wherePatterns(quads));
    });

    it('accepts the short form CONSTRUCT WHERE with an empty template', ({ expect }) => {
      const ast = parseConstruct(`CONSTRUCT WHERE { }`);
      expect(ast.template).toEqual([]);
      expect(ast.where.patterns).toEqual([]);
    });

    it('keeps dataset clauses and solution modifiers', ({ expect }) => {
      const ast = parseConstruct(`CONSTRUCT { GRAPH ?g { ?s ?p ?o } }
        FROM ex:default FROM NAMED ex:named
        WHERE { GRAPH ?g { ?s ?p ?o } } ORDER BY ?s LIMIT 10 OFFSET 5`);
      expect(ast.datasets.clauses).toHaveLength(2);
      expect(ast.solutionModifiers.order?.orderDefs).toHaveLength(1);
      expect(ast.solutionModifiers.limitOffset).toMatchObject({ limit: 10, offset: 5 });
    });

    it('tracks the source of quads', ({ expect }) => {
      const query = 'CONSTRUCT { ?s ?p ?o GRAPH ?g { ?s ?p ?o } } WHERE { GRAPH ?g { ?s ?p ?o } }';
      const ast = <QueryConstruct> sourceTrackingParser.parse(query);
      const [ bgp, graph ] = ast.template;
      expect(bgp.loc).toMatchObject({ sourceLocationType: 'source' });
      expect(graph.loc).toMatchObject({ sourceLocationType: 'source' });
      const slice = (loc: unknown): string => {
        const { start, end } = <{ start: number; end: number }> loc;
        return query.slice(start, end);
      };
      expect(slice(bgp.loc)).toBe('?s ?p ?o');
      expect(slice(graph.loc)).toBe('GRAPH ?g { ?s ?p ?o }');
    });

    it('lets the known keys transformer visit all nodes of the template', ({ expect }) => {
      for (const query of [
        'CONSTRUCT { ?s ?p ?o GRAPH ?g { ?s ?p ?o } } WHERE { GRAPH ?g { ?s ?p ?o } }',
        'CONSTRUCT WHERE { ?s ?p ?o GRAPH ?g { ?s ?p ?o } }',
      ]) {
        const ast = sourceTrackingParser.parse(query);
        expect(visitedNodes(knownKeysTransformer, ast)).toEqual(visitedNodes(new AstTransformer(), ast));
      }
    });
  });

  describe('invalid quads in CONSTRUCT templates', () => {
    const queries: Record<string, string> = {
      'a graph block without name': 'CONSTRUCT { GRAPH { ?s ?p ?o } } WHERE {}',
      'a literal as graph name': 'CONSTRUCT { GRAPH "g" { ?s ?p ?o } } WHERE {}',
      'a blank node as graph name': 'CONSTRUCT { GRAPH _:g { ?s ?p ?o } } WHERE {}',
      'nested graph blocks': 'CONSTRUCT { GRAPH ?g { GRAPH ?h { ?s ?p ?o } } } WHERE {}',
      'a property path in a graph block': 'CONSTRUCT { GRAPH ?g { ?s ex:p/ex:q ?o } } WHERE {}',
      'a filter in the template': 'CONSTRUCT { GRAPH ?g { ?s ?p ?o } FILTER(?o) } WHERE {}',
      'a group in the template': 'CONSTRUCT { { ?s ?p ?o } } WHERE {}',
      'a graph block without braces': 'CONSTRUCT { GRAPH ?g ?s ?p ?o } WHERE {}',
      'a double dot after a graph block': 'CONSTRUCT { GRAPH ?g { ?s ?p ?o } . . } WHERE {}',
      'DEFAULT as graph name': 'CONSTRUCT { GRAPH DEFAULT { ?s ?p ?o } } WHERE {}',
      'a short form reusing a blank node across basic graph patterns':
        'CONSTRUCT WHERE { _:b ?p ?o GRAPH ?g { _:b ?q ?r } }',
      'a short form with a property path': 'CONSTRUCT WHERE { GRAPH ?g { ?s ex:p+ ?o } }',
    };
    for (const [ name, query ] of Object.entries(queries)) {
      it(`rejects ${name}`, ({ expect }) => {
        expect(() => parser.parse(query, context)).toThrow();
        expect(() => sourceTrackingParser.parse(query, context)).toThrow();
      });
    }
  });

  /**
   * The extension should not change how the remainder of SPARQL 1.2 is parsed.
   * The ASTs Traqula expects differ only in the template of CONSTRUCT queries, see {@link toConstructQuadsAst}.
   */
  for (const suite of <const> [ 'sparql-1-1', 'sparql-1-2' ]) {
    describe(`Traqula positive ${suite} tests`, () => {
      for (const { name, statics } of positiveTest(suite)) {
        it(`can parse ${name}`, async({ expect }) => {
          const { query, astWithSource } = await statics();
          const expectedWithSource = toConstructQuadsAst(astWithSource);
          const expectedNoSource = astFactory.forcedAutoGenTree(<object> expectedWithSource);

          const res: unknown = sourceTrackingParser.parse(query, context);
          expect(visitedNodes(knownKeysTransformer, res)).toEqual(visitedNodes(new AstTransformer(), res));
          const resNoSource = parser.parse(query, context);
          if (suite === 'sparql-1-1') {
            // Like the upstream SPARQL 1.2 parser, the annotations of triples are an addition to the SPARQL 1.1 AST
            expect(res, 'source tracking res')
              .toEqualParsedQueryIgnoring(obj => astFactory.isTriple(obj), [ 'annotations' ], expectedWithSource);
            expect(resNoSource, 'no source tracking res')
              .toEqualParsedQueryIgnoring(obj => astFactory.isTriple(obj), [ 'annotations' ], expectedNoSource);
          } else {
            expect(res, 'source tracking res').toEqualParsedQuery(expectedWithSource);
            expect(resNoSource, 'no source tracking res').toEqualParsedQuery(expectedNoSource);
          }
        });
      }
    });
  }

  for (const suite of <const> [ 'sparql-1-1-invalid', 'sparql-1-2-invalid' ]) {
    describe(`Traqula negative ${suite} tests`, () => {
      for (const { name, statics, namedAggregatorCallback } of negativeTest(suite)) {
        it(`should NOT parse ${name}`, async({ expect }) => {
          const { query } = await statics();
          const negativeContext = { ...context, namedAggregatorCallback };
          expect(() => sourceTrackingParser.parse(query, negativeContext)).toThrow();
          expect(() => parser.parse(query, negativeContext)).toThrow();
        });
      }
    });
  }
});
