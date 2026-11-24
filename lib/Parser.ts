import { ParserBuilder } from '@traqula/core';
import type { ParserBuildArgs } from '@traqula/core';
import { sparql12ParserBuilder } from '@traqula/parser-sparql-1-2';
import type { gram as g11 } from '@traqula/rules-sparql-1-1';
import { completeParseContext, copyParseContext, lex as l12 } from '@traqula/rules-sparql-1-2';
import type * as T12 from '@traqula/rules-sparql-1-2';
import { constructQuads, constructQuery, constructTemplate } from './grammar.js';
import type { Query, SparqlQuery } from './types.js';

/**
 * Pre-configured {@link ParserBuilder} for SPARQL 1.2 with quads in CONSTRUCT templates,
 * extending the SPARQL 1.2 parser builder.
 * Use {@link ParserBuilder.create ParserBuilder.create(constructQuadsParserBuilder)} to extend it further.
 */
export const constructQuadsParserBuilder = ParserBuilder.create(sparql12ParserBuilder)
  .addRule(constructQuads)
  .patchRule(constructTemplate)
  .patchRule(constructQuery)
  .typePatch<{
    // Rules whose return type changed because they (indirectly) return a CONSTRUCT query.
    [g11.queryOrUpdate.name]: [SparqlQuery];
    [g11.queryUnit.name]: [Query];
    [g11.query.name]: [Query];
  }>();

export type ConstructQuadsParser = ReturnType<typeof constructQuadsParserBuilder.build>;

/**
 * Parser that can parse a SPARQL 1.2 string, with quads allowed in CONSTRUCT templates, into an AST.
 */
export class Parser {
  private readonly parser: ConstructQuadsParser;
  protected readonly defaultContext: T12.SparqlContext;

  public constructor(
    args: Pick<ParserBuildArgs, 'parserConfig' | 'lexerConfig'> & { defaultContext?: Partial<T12.SparqlContext> } = {},
  ) {
    this.parser = constructQuadsParserBuilder.build({
      ...args,
      tokenVocabulary: l12.sparql12LexerBuilder.tokenVocabulary,
    });
    this.defaultContext = completeParseContext(args.defaultContext ?? {});
  }

  /**
   * Parse a query string starting from the
   * [QueryUnit](https://www.w3.org/TR/sparql12-query/#rQueryUnit)
   * or [UpdateUnit](https://www.w3.org/TR/sparql12-query/#rUpdateUnit) rules.
   * @param query - the query string.
   * @param context - the context of this parse, overriding the default context.
   */
  public parse(query: string, context: Partial<T12.SparqlContext> = {}): SparqlQuery {
    const ast = this.parser.queryOrUpdate(query, copyParseContext({ ...this.defaultContext, ...context }));
    ast.loc = this.defaultContext.astFactory.sourceLocationInlinedSource(query, ast.loc, 0, Number.MAX_SAFE_INTEGER);
    return ast;
  }
}
