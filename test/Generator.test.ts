import { traqulaIndentation } from '@traqula/core';
import { AstFactory } from '@traqula/rules-sparql-1-2';
import type * as T11 from '@traqula/rules-sparql-1-1';
import type * as T12 from '@traqula/rules-sparql-1-2';
import { positiveTest } from '@traqula/test-utils';
import { describe, it } from 'vitest';
import type { QueryConstruct, SparqlQuery } from '../lib/index.js';
import { Generator, Parser } from '../lib/index.js';
import { toConstructQuadsAst } from './upstreamAst.js';

describe('a SPARQL 1.2 generator with quads in CONSTRUCT templates', () => {
  const generator = new Generator();
  const oneLineGenerator = new Generator({
    indentInc: 0,
    [traqulaIndentation]: -1,
  });
  const F = new AstFactory();
  const sourceTrackingParser = new Parser({
    defaultContext: { astFactory: F },
    lexerConfig: { positionTracking: 'full' },
  });
  const parser = new Parser();

  function autoGenerate(ast: SparqlQuery): SparqlQuery {
    const autoGenAst = F.forcedAutoGenTree(ast);
    autoGenAst.loc = F.sourceLocationNodeReplaceUnsafe(ast.loc);
    return autoGenAst;
  }

  describe('quads in CONSTRUCT templates', () => {
    const queries = [
      'CONSTRUCT { GRAPH ?g { ?s ?p ?o } } WHERE { GRAPH ?g { ?s ?p ?o } }',
      `PREFIX ex: <http://example.org/>
CONSTRUCT {
  ?s a ex:Thing .
  GRAPH ex:g1 { ?s ex:p ?o } .
  GRAPH ?g { ?s ex:q ?o ; ex:r [ ex:t 1 ] }
  ?o a ex:Other
}
FROM NAMED ex:named
WHERE { GRAPH ?g { ?s ?p ?o } }
ORDER BY ?s
LIMIT 10`,
      'CONSTRUCT {GRAPH<http://ex.org/g>{?s ?p ?o}GRAPH ?g{}}WHERE{GRAPH ?g{?s ?p ?o}}',
      'CONSTRUCT { } WHERE { ?s ?p ?o }',
      'CONSTRUCT WHERE { ?s ?p ?o GRAPH ?g { ?s ?p ?x } . }',
      'CONSTRUCT FROM <http://ex.org/d> WHERE { GRAPH ?g { ?s ?p ?x } } LIMIT 1',
      'CONSTRUCT WHERE { }',
      'CONSTRUCT { GRAPH ?g { ?s ?p ?o {| <http://ex.org/since> 2024 |} } } WHERE { GRAPH ?g { ?s ?p ?o } }',
    ];

    for (const query of queries) {
      it(`round-trips ${query.replaceAll(/\s+/gu, ' ')}`, ({ expect }) => {
        expect(generator.generate(sourceTrackingParser.parse(query))).toEqual(query);
      });
    }

    it('auto generates quads', ({ expect }) => {
      const ast = sourceTrackingParser.parse(`PREFIX ex: <http://example.org/>
        CONSTRUCT { ?s ex:type ex:Thing . GRAPH ex:g1 { ?s ex:p ?o } GRAPH ?g { ?s ex:q ?o } ?o ex:type ex:Other }
        WHERE { GRAPH ?g { ?s ?p ?o } }`);
      expect(generator.generate(autoGenerate(ast))).toEqual(`PREFIX ex: <http://example.org/>
CONSTRUCT {
  ?s ex:type ex:Thing .
  GRAPH ex:g1 {
    ?s ex:p ?o .
  }
  GRAPH ?g {
    ?s ex:q ?o .
  }
  ?o ex:type ex:Other .
}
WHERE {
  GRAPH ?g {
    ?s ?p ?o .
  }
}`);
      expect(oneLineGenerator.generate(autoGenerate(ast))).toEqual(
        'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ex:type ex:Thing . GRAPH ex:g1 { ?s ex:p ?o . } ' +
        'GRAPH ?g { ?s ex:q ?o . } ?o ex:type ex:Other . } WHERE { GRAPH ?g { ?s ?p ?o . } }',
      );
    });

    it('auto generates a short form as the long form', ({ expect }) => {
      const ast = sourceTrackingParser.parse('CONSTRUCT WHERE { ?s ?p ?o GRAPH ?g { ?s ?p ?x } }');
      expect(oneLineGenerator.generate(autoGenerate(ast))).toEqual(
        'CONSTRUCT { ?s ?p ?o . GRAPH ?g { ?s ?p ?x . } } WHERE { ?s ?p ?o . GRAPH ?g { ?s ?p ?x . } }',
      );
    });

    it('generates queries parsed without source tracking', ({ expect }) => {
      const query = 'CONSTRUCT { ?s ?p ?o GRAPH ?g { ?s ?p ?o } } WHERE { GRAPH ?g { ?s ?p ?o } }';
      const generated = oneLineGenerator.generate(parser.parse(query));
      expect(generated).toEqual(
        'CONSTRUCT { ?s ?p ?o . GRAPH ?g { ?s ?p ?o . } } WHERE { GRAPH ?g { ?s ?p ?o . } }',
      );
      expect(parser.parse(generated)).toEqual(parser.parse(query));
    });

    it('generates a template built with the AST factory', ({ expect }) => {
      const s = F.termVariable('s', F.gen());
      const p = F.termVariable('p', F.gen());
      const o = F.termVariable('o', F.gen());
      const g = F.termNamed(F.gen(), 'http://example.org/g');
      const bgp = (): T11.PatternBgp => F.patternBgp([ F.triple(s, p, o) ], F.gen());
      const query = <QueryConstruct> {
        type: 'query',
        subType: 'construct',
        context: [],
        template: <T12.Quads[]> [ bgp(), F.graphQuads(g, bgp(), F.gen()) ],
        datasets: F.datasetClauses([], F.gen()),
        where: <T12.PatternGroup> F.patternGroup([ bgp() ], F.gen()),
        solutionModifiers: {},
        loc: F.gen(),
      };
      expect(oneLineGenerator.generate(query)).toEqual(
        'CONSTRUCT { ?s ?p ?o . GRAPH <http://example.org/g> { ?s ?p ?o . } } WHERE { ?s ?p ?o . }',
      );
    });
  });

  /**
   * The extension should not change how the remainder of SPARQL 1.2 is generated.
   */
  for (const suite of <const> [ 'sparql-1-1', 'sparql-1-2' ]) {
    describe(`Traqula positive ${suite} tests`, () => {
      for (const { name, statics } of positiveTest(suite)) {
        it(`can generate ${name}`, async({ expect }) => {
          const { query, astWithSource, autoGen, autoGenCompact } = await statics();
          const ast = toConstructQuadsAst(<SparqlQuery> astWithSource);

          expect(generator.generate(ast), 'round-tripped generation').toEqual(query.trim());
          expect(generator.generate(autoGenerate(ast)), 'auto generated').toEqual(autoGen.trim());
          expect(oneLineGenerator.generate(autoGenerate(ast)), 'one line generation').toEqual(autoGenCompact.trim());
        });
      }
    });
  }
});
