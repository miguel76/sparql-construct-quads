import type * as T12 from '@traqula/rules-sparql-1-2';

/**
 * The template of a CONSTRUCT query, extended to hold quads.
 *
 * Each element is either a {@link T12.PatternBgp} holding triples of the default graph,
 * or a {@link T12.GraphQuads} holding the triples of a `GRAPH <g> { ... }` block.
 * The elements keep the order in which they appear in the query, so a template can be generated back as it was parsed.
 * This is the same representation SPARQL 1.2 Update uses for the quads of `INSERT` and `DELETE` clauses.
 *
 * ```sparql
 * CONSTRUCT {
 *   ?s ?p ?o .                    # PatternBgp
 *   GRAPH ?g { ?s ?p ?o }         # GraphQuads
 * } WHERE { GRAPH ?g { ?s ?p ?o } }
 * ```
 */
export type ConstructTemplate = T12.Quads[];

/**
 * A CONSTRUCT query whose template may contain `GRAPH` blocks.
 * Compared to {@link T12.QueryConstruct}, the `template` is a {@link ConstructTemplate} instead of a single BGP.
 * A template without `GRAPH` blocks is a list holding one BGP, or no element at all when the template is empty.
 */
export type QueryConstruct = Omit<T12.QueryConstruct, 'template'> & {
  template: ConstructTemplate;
};

/**
 * Any query of this extension: the SPARQL 1.2 queries with the CONSTRUCT query replaced by {@link QueryConstruct}.
 */
export type Query = T12.QuerySelect | QueryConstruct | T12.QueryDescribe | T12.QueryAsk;

/**
 * The result of parsing a query or update with this extension.
 */
export type SparqlQuery = Query | T12.Update;
