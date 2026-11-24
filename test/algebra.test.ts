import { toAlgebra as toAlgebra12 } from '@traqula/algebra-sparql-1-2';
import { AlgebraFactory, Canonicalizer, Types, algebraUtils } from '@traqula/algebra-transformations-1-2';
import type { Algebra } from '@traqula/algebra-transformations-1-2';
import { TransformerSubTyped } from '@traqula/core';
import { Parser as Parser12 } from '@traqula/parser-sparql-1-2';
import { AstFactory, AstTransformer, astKnownKeysAllowlist } from '@traqula/rules-sparql-1-2';
import type * as T12 from '@traqula/rules-sparql-1-2';
import { sparqlAlgebraNegativeTests, sparqlAlgebraOnlyTests, sparqlAlgebraTests } from '@traqula/test-utils';
import type { AlgebraTestSuite, NegativeAlgebraSuite } from '@traqula/test-utils';
import { DataFactory } from 'rdf-data-factory';
import { describe, expect, it } from 'vitest';
import type { QueryConstruct } from '../lib/index.js';
import { Generator, Parser, toAlgebra, toAst } from '../lib/index.js';

const suites: AlgebraTestSuite[] = [ 'dawg-syntax', 'sparql11-query', 'sparql-1.1', 'sparql12' ];

/**
 * Transformers that only visit the keys the allowlists allow, so they skip unknown keys.
 */
const knownKeysTransformers = {
  astTransformer: new AstTransformer({ visitChildren: () => {} }, astKnownKeysAllowlist),
  algebraTransformer: new TransformerSubTyped<Algebra.Operation>(
    { visitChildren: () => {} },
    algebraUtils.knownKeysAllowlist,
  ),
};

describe('the algebra of quads in CONSTRUCT templates', () => {
  const DF = new DataFactory();
  const AF = new AlgebraFactory(DF);
  const canon = new Canonicalizer();
  const parser = new Parser();
  const parser12 = new Parser12();
  const generator = new Generator({ indentInc: 0 });
  const ex = (name: string): ReturnType<typeof DF.namedNode> => DF.namedNode(`http://example.org/${name}`);
  const [ s, p, o, g ] = [ 's', 'p', 'o', 'g' ].map(name => DF.variable(name));
  const prefix = 'PREFIX ex: <http://example.org/> ';

  /**
   * The algebra of a query, as objects that can be compared.
   */
  function algebraOf(query: string, options: Parameters<typeof toAlgebra>[1] = {}): Algebra.Operation {
    const ast = parser.parse(query);
    const algebra = algebraUtils.objectify(toAlgebra(ast, options));
    // Translating with transformers that only visit known keys gives the same algebra
    expect(algebraUtils.objectify(toAlgebra(ast, { ...options, ...knownKeysTransformers }))).toEqual(algebra);
    return algebra;
  }

  /**
   * Finds the CONSTRUCT operation in the given algebra.
   */
  function constructOf(operation: Algebra.Operation): Algebra.Construct {
    while (operation.type !== Types.CONSTRUCT) {
      operation = <Algebra.Operation> (<Algebra.Single> operation).input;
    }
    return operation;
  }

  /**
   * The algebra the upstream SPARQL 1.2 translation gives to a query.
   */
  function upstreamAlgebraOf(query: string): Algebra.Operation {
    return algebraUtils.objectify(toAlgebra12(<T12.Query> parser12.parse(query)));
  }

  describe('to algebra', () => {
    it('translates triples to patterns in the default graph and graph blocks to patterns in their graph', ({ expect }) => {
      const query = `${prefix}CONSTRUCT {
        ?s ex:p ?o .
        GRAPH ex:g { ?s ex:q ?o }
        GRAPH ?g { ?s ex:r ?o . ?o ex:s ?s }
        ?o ex:t ?s
      } WHERE { GRAPH ?g { ?s ?p ?o } }`;
      const construct = <Algebra.Construct> algebraOf(query);
      expect(construct.type).toBe(Types.CONSTRUCT);
      expect(construct.template).toEqual(algebraUtils.objectify([
        AF.createPattern(s, ex('p'), o),
        AF.createPattern(s, ex('q'), o, ex('g')),
        AF.createPattern(s, ex('r'), o, g),
        AF.createPattern(o, ex('s'), s, g),
        AF.createPattern(o, ex('t'), s),
      ]));
      expect(construct.template[0].graph.termType).toBe('DefaultGraph');
      // The WHERE clause is translated as before
      expect(construct.input)
        .toEqual(constructOf(upstreamAlgebraOf('CONSTRUCT {} WHERE { GRAPH ?g { ?s ?p ?o } }')).input);
    });

    it('translates a template without graph blocks like SPARQL 1.2', ({ expect }) => {
      const query = `${prefix}CONSTRUCT { ?s ex:p ?o . ?o ex:q [ ex:r ?s ] } WHERE { ?s ?p ?o } LIMIT 5`;
      expect(canon.canonicalizeQuery(algebraOf(query), false))
        .toEqual(canon.canonicalizeQuery(upstreamAlgebraOf(query), false));
    });

    it('translates the template below slices and dataset clauses', ({ expect }) => {
      const query = `${prefix}CONSTRUCT { GRAPH ?g { ?s ?p ?o } }
        FROM ex:d FROM NAMED ex:n
        WHERE { GRAPH ?g { ?s ?p ?o } } LIMIT 10 OFFSET 2`;
      const algebra = algebraOf(query);
      expect(algebra.type).toBe(Types.FROM);
      expect((<Algebra.From> algebra).input.type).toBe(Types.SLICE);
      expect(constructOf(algebra).template).toEqual(algebraUtils.objectify([ AF.createPattern(s, p, o, g) ]));
      const upstream = upstreamAlgebraOf(`${prefix}CONSTRUCT {} FROM ex:d FROM NAMED ex:n
        WHERE { GRAPH ?g { ?s ?p ?o } } LIMIT 10 OFFSET 2`);
      constructOf(upstream).template = constructOf(algebra).template;
      expect(algebra).toEqual(upstream);
    });

    it('translates the short form CONSTRUCT WHERE', ({ expect }) => {
      const algebra = algebraOf(`${prefix}CONSTRUCT WHERE { ?s ex:p ?o GRAPH ?g { ?o ex:q ?s } }`);
      const expected = AF.createConstruct(
        AF.createJoin([
          AF.createBgp([ AF.createPattern(s, ex('p'), o) ]),
          AF.createGraph(AF.createBgp([ AF.createPattern(o, ex('q'), s) ]), g),
        ]),
        [ AF.createPattern(s, ex('p'), o), AF.createPattern(o, ex('q'), s, g) ],
      );
      expect(canon.canonicalizeQuery(algebra, false)).toEqual(canon.canonicalizeQuery(algebraUtils.objectify(expected), false));
    });

    it('shares the blank nodes of a template across its graphs, and keeps them blank nodes', ({ expect }) => {
      for (const blankToVariable of [ false, true ]) {
        const construct = <Algebra.Construct> algebraOf(
          `${prefix}CONSTRUCT { _:b ex:p ?o . GRAPH ex:g { _:b ex:q [] } } WHERE { ?s ?p ?o }`,
          { blankToVariable },
        );
        const [ first, second ] = construct.template;
        expect(first.subject.termType).toBe('BlankNode');
        expect(second.subject).toEqual(first.subject);
        expect(second.object.termType).toBe('BlankNode');
        expect(second.object).not.toEqual(first.subject);
      }
    });

    it('translates SPARQL 1.2 reified triples in a graph block to patterns in that graph', ({ expect }) => {
      const construct = <Algebra.Construct> algebraOf(
        `${prefix}CONSTRUCT { GRAPH ?g { ?s ex:p ?o ~ ex:r {| ex:since 2024 |} } } WHERE { GRAPH ?g { ?s ?p ?o } }`,
      );
      expect(construct.template).toHaveLength(3);
      for (const pattern of construct.template) {
        expect(pattern.graph).toEqual(g);
      }
    });
  });

  describe('to AST', () => {
    const queries = [
      `${prefix}CONSTRUCT { ?s ex:p ?o . GRAPH ex:g { ?s ex:q ?o } GRAPH ?g { ?s ex:r ?o . ?o ex:s ?s } ?o ex:t ?s }
        WHERE { GRAPH ?g { ?s ?p ?o } }`,
      `${prefix}CONSTRUCT { GRAPH ?g { ?s ?p ?o } } FROM ex:d FROM NAMED ex:n WHERE { GRAPH ?g { ?s ?p ?o } }
        ORDER BY ?s LIMIT 10 OFFSET 2`,
      `${prefix}CONSTRUCT WHERE { ?s ex:p ?o GRAPH ?g { ?o ex:q ?s } }`,
      `${prefix}CONSTRUCT { _:b ex:p ?o . GRAPH ex:g { _:b ex:q [] } } WHERE { ?s ?p ?o }`,
      `${prefix}CONSTRUCT { } WHERE { ?s ?p ?o }`,
      `${prefix}CONSTRUCT { GRAPH ?g { ?s ?p ?o } } WHERE { { SELECT ?g (COUNT(*) AS ?o) WHERE { GRAPH ?g { ?s ?p ?x } } GROUP BY ?g ?s ?p } }`,
    ];
    for (const query of queries) {
      it(`translates the algebra of ${query.replaceAll(/\s+/gu, ' ')} back to an equivalent query`, ({ expect }) => {
        const algebra = algebraOf(query);
        const generated = generator.generate(toAst(algebra));
        expect(canon.canonicalizeQuery(algebraOf(generated), false)).toEqual(canon.canonicalizeQuery(algebra, false));
        // Translating with transformers that only visit known keys gives the same query
        expect(generator.generate(toAst(algebra, knownKeysTransformers))).toEqual(generated);
      });
    }

    it('groups consecutive patterns of the same graph', ({ expect }) => {
      const algebra = AF.createConstruct(AF.createBgp([ AF.createPattern(s, p, o) ]), [
        AF.createPattern(s, ex('a'), o),
        AF.createPattern(s, ex('b'), o),
        AF.createPattern(s, ex('c'), o, g),
        AF.createPattern(s, ex('d'), o, g),
        AF.createPattern(s, ex('e'), o, ex('g')),
        AF.createPattern(s, ex('f'), o),
      ]);
      const ast = <QueryConstruct> toAst(algebra);
      expect(ast.template.map(quads => quads.type)).toEqual([ 'pattern', 'graph', 'graph', 'pattern' ]);
      expect(generator.generate(ast).replaceAll(/\s+/gu, ' ')).toEqual(
        'CONSTRUCT { ?s <http://example.org/a> ?o . ?s <http://example.org/b> ?o . ' +
        'GRAPH ?g { ?s <http://example.org/c> ?o . ?s <http://example.org/d> ?o . } ' +
        'GRAPH <http://example.org/g> { ?s <http://example.org/e> ?o . } ' +
        '?s <http://example.org/f> ?o . } WHERE { ?s ?p ?o . }',
      );
    });

    it('translates an empty template to an empty list', ({ expect }) => {
      const ast = <QueryConstruct> toAst(AF.createConstruct(AF.createBgp([]), []));
      expect(ast.template).toEqual([]);
      expect(generator.generate(ast).replaceAll(/\s+/gu, ' ')).toEqual('CONSTRUCT { } WHERE { }');
    });
  });

  /**
   * The extension should not change the algebra of the remainder of SPARQL 1.2.
   */
  describe('Traqula algebra tests', () => {
    for (const suite of suites) {
      describe(suite, () => {
        for (const blankToVariable of [ true, false ]) {
          for (const test of sparqlAlgebraTests(suite, blankToVariable, true)) {
            const { name, json, sparql: query, namedAggregatorCallback } = test;
            it(`${name}${blankToVariable ? ' (no blanks)' : ''}`, ({ expect }) => {
              const ast = parser.parse(query, { namedAggregatorCallback });
              const options = { quads: name.endsWith('-quads'), blankToVariable, namedAggregatorCallback };
              const algebra = algebraUtils.objectify(toAlgebra(ast, options));
              expect(canon.canonicalizeQuery(algebra, blankToVariable))
                .toEqual(canon.canonicalizeQuery(<Algebra.Operation>json, blankToVariable));
              const knownKeysAlgebra = algebraUtils.objectify(toAlgebra(ast, { ...options, ...knownKeysTransformers }));
              expect(canon.canonicalizeQuery(knownKeysAlgebra, blankToVariable))
                .toEqual(canon.canonicalizeQuery(<Algebra.Operation>json, blankToVariable));
            });
          }
        }
      });
    }

    for (const suite of [ 'sparql-1.1-negative', 'sparql-1.2-negative' ] satisfies NegativeAlgebraSuite[]) {
      describe(suite, () => {
        for (const test of sparqlAlgebraNegativeTests(suite)) {
          it(test.name, async({ expect }) => {
            const { query } = await test.statics();
            const ast = parser.parse(query, { skipValidation: true });
            expect(() => algebraUtils.objectify(toAlgebra(ast))).toThrow();
          });
        }
      });
    }
  });

  describe('Traqula algebra to AST tests', () => {
    const prettyGenerator = new Generator();
    const astFactory = new AstFactory();
    for (const suite of suites) {
      describe(suite, () => {
        for (const test of sparqlAlgebraTests(suite, false, false)) {
          const { name, json, quads, namedAggregatorCallback } = test;
          const expected = <Algebra.Operation> json;
          it(name, ({ expect }) => {
            const genQuery = prettyGenerator.generate(toAst(expected));
            const ast = parser.parse(genQuery, { namedAggregatorCallback });
            const algebra = algebraUtils.objectify(toAlgebra(ast, { quads, namedAggregatorCallback }));
            expect(canon.canonicalizeQuery(algebra, false)).toEqual(canon.canonicalizeQuery(expected, false));
          });
        }
      });
    }

    for (const suite of suites) {
      for (const blankToVariable of [ true, false ]) {
        describe(`${suite} canonical SPARQL${blankToVariable ? ' with blank to var' : ''}`, () => {
          for (const test of sparqlAlgebraTests(suite, blankToVariable, true)) {
            const { name, quads, canonicalSparql, sparql, namedAggregatorCallback } = test;
            it(name, ({ expect }) => {
              astFactory.resetBlankNodeCounter();
              const algebra = toAlgebra(parser.parse(sparql, { astFactory, namedAggregatorCallback }), {
                quads,
                blankToVariable,
                namedAggregatorCallback,
              });
              expect(prettyGenerator.generate(toAst(algebra)).trim()).toEqual(canonicalSparql.trim());
            });
          }
        });
      }
    }

    for (const { name, json, canonicalSparql } of sparqlAlgebraOnlyTests('sparql-1.1-algebra-only')) {
      it(`algebra only ${name}`, ({ expect }) => {
        expect(prettyGenerator.generate(toAst(<Algebra.Operation> json)).trim()).toEqual(canonicalSparql.trim());
      });
    }
  });
});
