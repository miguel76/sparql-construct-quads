import type * as RDF from '@rdfjs/types';
import { toAst12Builder } from '@traqula/algebra-sparql-1-2';
import {
  algToSparql,
  translateAlgPattern,
  translateAlgProject,
  translateAlgTerm,
  Types,
} from '@traqula/algebra-transformations-1-1';
import type { AlgQueryForm } from '@traqula/algebra-transformations-1-1';
import { createAstContext } from '@traqula/algebra-transformations-1-2';
import type { Algebra, AstIndir, TransformerConfigs } from '@traqula/algebra-transformations-1-2';
import { IndirBuilder } from '@traqula/core';
import type * as T11 from '@traqula/rules-sparql-1-1';
import type * as T12 from '@traqula/rules-sparql-1-2';
import type { ConstructTemplate, QueryConstruct, SparqlQuery } from './types.js';

/**
 * Translates the quad patterns of a CONSTRUCT operation to the template of a CONSTRUCT query.
 * Consecutive patterns in the same graph are grouped:
 * patterns in the default graph become a BGP, patterns in a named graph or variable become a `GRAPH` block.
 */
export const translateAlgConstructTemplate:
AstIndir<'translateConstructTemplate', ConstructTemplate, [Algebra.Pattern[]]> = {
  name: 'translateConstructTemplate',
  fun: ({ SUBRULE }) => ({ astFactory: F }, patterns) => {
    const template: ConstructTemplate = [];
    let currentGraph: RDF.Term | undefined;
    let currentTriples: T12.BasicGraphPattern | undefined;
    for (const pattern of patterns) {
      // Patterns without graph are in the default graph. Algebra need not consist of RDF/JS terms with `equals`.
      const graph: RDF.Term = pattern.graph ?? defaultGraph;
      if (!currentTriples || graph.termType !== currentGraph!.termType || graph.value !== currentGraph!.value) {
        currentGraph = graph;
        currentTriples = [];
        const bgp = F.patternBgp(<T11.BasicGraphPattern> currentTriples, F.gen());
        template.push(<T12.Quads> (graph.termType === 'DefaultGraph' ?
          bgp :
          F.graphQuads(<T11.TermIri | T11.TermVariable> SUBRULE(translateAlgTerm, graph), bgp, F.gen())));
      }
      currentTriples.push(SUBRULE(translateAlgPattern, pattern));
    }
    return template;
  },
};

const defaultGraph: RDF.DefaultGraph = { termType: 'DefaultGraph', value: '', equals: term => term?.termType === 'DefaultGraph' };

const originalTranslateAlgProject = toAst12Builder.getRule(translateAlgProject.name);

/**
 * OVERRIDING RULE: {@link translateAlgProject}.
 * Wraps the original rule, which translates the template of a CONSTRUCT operation to triples,
 * replacing that template by one holding the quads.
 */
export const translateAlgProjectConstructQuads:
AstIndir<(typeof translateAlgProject)['name'], T12.PatternGroup, [AlgQueryForm, string]> = {
  name: translateAlgProject.name,
  fun: $ => (C, op, type) => {
    const group = <T12.PatternGroup> originalTranslateAlgProject.fun($)(C, op, type);
    if (type === Types.CONSTRUCT) {
      // The original rule returns the query in a group, as a subquery
      const query = <QueryConstruct> <unknown> group.patterns[0];
      query.template = $.SUBRULE(translateAlgConstructTemplate, (<Algebra.Construct> op).template);
    }
    return group;
  },
};

/**
 * Pre-configured {@link IndirBuilder} for translating SPARQL Algebra back to an AST of this extension.
 * Extends the SPARQL 1.2 algebra-to-AST builder, translating quad patterns of CONSTRUCT operations to quads.
 * Use {@link IndirBuilder.create IndirBuilder.create(constructQuadsToAstBuilder)} to extend it.
 */
export const constructQuadsToAstBuilder = IndirBuilder
  .create(toAst12Builder)
  .addRule(translateAlgConstructTemplate)
  .patchRule(translateAlgProjectConstructQuads)
  .typePatch<{
    [algToSparql.name]: [SparqlQuery, [Algebra.Operation]];
  }>();

/**
 * Transform an operation to an AST of this extension.
 * @param op - the operation to transform.
 * @param options - the transformers the rules traverse with, defaulting to ones that visit all keys.
 * @returns the AST of the operation.
 */
export function toAst(op: Algebra.Operation, options: TransformerConfigs = {}): SparqlQuery {
  const c = createAstContext(options);
  const transformer = constructQuadsToAstBuilder.build();
  return transformer.algToSparql(c, op);
}
