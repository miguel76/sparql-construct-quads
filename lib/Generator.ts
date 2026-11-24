import { GeneratorBuilder } from '@traqula/core';
import { sparql12GeneratorBuilder } from '@traqula/generator-sparql-1-2';
import type { gram as g11 } from '@traqula/rules-sparql-1-1';
import { completeGeneratorContext } from '@traqula/rules-sparql-1-2';
import type * as T12 from '@traqula/rules-sparql-1-2';
import { constructQuads, constructQuery } from './grammar.js';
import type { Query, SparqlQuery } from './types.js';

/**
 * Pre-configured {@link GeneratorBuilder} for SPARQL 1.2 with quads in CONSTRUCT templates,
 * extending the SPARQL 1.2 generator builder.
 * Use {@link GeneratorBuilder.create GeneratorBuilder.create(constructQuadsGeneratorBuilder)} to extend it further.
 */
export const constructQuadsGeneratorBuilder = GeneratorBuilder.create(sparql12GeneratorBuilder)
  .addRule(constructQuads)
  .patchRule(constructQuery)
  .typePatch<{
    // Rules whose input type changed because they (indirectly) generate a CONSTRUCT query.
    [g11.queryOrUpdate.name]: [SparqlQuery];
    [g11.query.name]: [Query];
  }>();

export type ConstructQuadsGenerator = ReturnType<typeof constructQuadsGeneratorBuilder.build>;

/**
 * Generator that can generate a query string from an AST of this extension,
 * generating quads in CONSTRUCT templates.
 */
export class Generator {
  protected readonly defaultContext: T12.SparqlGeneratorContext;
  private readonly generator: ConstructQuadsGenerator = constructQuadsGeneratorBuilder.build();

  public constructor(defaultContext: Partial<T12.SparqlGeneratorContext> = {}) {
    this.defaultContext = completeGeneratorContext(defaultContext);
  }

  /**
   * Generates a query string starting from the
   * [QueryUnit](https://www.w3.org/TR/sparql12-query/#rQueryUnit)
   * or [UpdateUnit](https://www.w3.org/TR/sparql12-query/#rUpdateUnit) rules.
   * @param ast - the AST of the query or update.
   * @param context - the context of this generation, overriding the default context.
   */
  public generate(ast: SparqlQuery, context: Partial<T12.SparqlGeneratorContext> = {}): string {
    return this.generator.queryOrUpdate(ast, { ...this.defaultContext, ...context }).trim();
  }
}
