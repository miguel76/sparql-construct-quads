/**
 * Grammar rules extending the SPARQL 1.2 grammar with quads in CONSTRUCT templates.
 *
 * The extension changes the following productions of the
 * [SPARQL 1.2 grammar](https://www.w3.org/TR/sparql12-query/#sparqlGrammar):
 *
 * ```ebnf
 * ConstructTemplate ::= '{' ConstructQuads '}'
 * ConstructQuads    ::= ConstructTriples? ( QuadsNotTriples '.'? ConstructTriples? )*
 * ```
 *
 * `QuadsNotTriples` is the existing SPARQL Update production `'GRAPH' VarOrIri '{' TriplesTemplate? '}'`.
 * Since `ConstructQuery` uses `ConstructTemplate` in both its forms,
 * the short form `CONSTRUCT WHERE { ... }` accepts `GRAPH` blocks as well.
 *
 * Rules in this module redefine the return type of core grammar rules,
 * the builders in this package retype the rules calling them accordingly.
 */
import type { IToken } from '@traqula/chevrotain';
import type { Localized, SourceLocation, Wrap } from '@traqula/core';
import { traqulaIndentation } from '@traqula/core';
import { sparql12ParserBuilder } from '@traqula/parser-sparql-1-2';
import { gram as g11, lex as l11 } from '@traqula/rules-sparql-1-1';
import type * as T11 from '@traqula/rules-sparql-1-1';
import type { AstFactory, SparqlGrammarRule, SparqlRule } from '@traqula/rules-sparql-1-2';
import type * as T12 from '@traqula/rules-sparql-1-2';
import type { ConstructTemplate, QueryConstruct } from './types.js';

/**
 * The part of a {@link QueryConstruct} the `constructQuery` rule is responsible for.
 */
export type ConstructQueryBody = Omit<QueryConstruct, g11.HandledByBase>;

/**
 * Translates the quads of a construct template to the patterns of an equivalent WHERE clause:
 * a BGP stays a BGP, and a `GRAPH` block becomes a `GRAPH` graph pattern containing its BGP.
 * Used by the short form `CONSTRUCT WHERE { ... }`, where the template doubles as the WHERE clause.
 */
export function constructTemplateToPatterns(F: AstFactory, template: ConstructTemplate): T12.Pattern[] {
  return template.map(quads => F.isGraphQuads(quads) ?
    <T12.PatternGraph> F.patternGraph(quads.graph, [ <T11.PatternBgp> quads.triples ], quads.loc) :
    <T12.PatternBgp> quads);
}

/**
 * Production `ConstructQuads ::= ConstructTriples? ( QuadsNotTriples '.'? ConstructTriples? )*`.
 * Mirrors {@link g11.quads} (SPARQL Update), using the triples of a construct template.
 */
export const constructQuads: SparqlRule<'constructQuads', Wrap<ConstructTemplate>> = <const> {
  name: 'constructQuads',
  impl: ({ ACTION, SUBRULE1, SUBRULE2, SUBRULE3, CONSUME, MANY, OPTION1, OPTION2, OPTION3 }) => (C) => {
    const quads: ConstructTemplate = [];
    let last: IToken | Localized | undefined;

    OPTION1(() => {
      const triples = <T12.PatternBgp> SUBRULE1(g11.constructTriples);
      last = triples;
      ACTION(() => quads.push(triples));
    });

    MANY(() => {
      const graph = <T12.GraphQuads> SUBRULE2(g11.quadsNotTriples);
      last = graph;
      ACTION(() => quads.push(graph));
      OPTION2(() => {
        last = CONSUME(l11.symbols.dot);
      });
      OPTION3(() => {
        const triples = <T12.PatternBgp> SUBRULE3(g11.constructTriples);
        last = triples;
        ACTION(() => quads.push(triples));
      });
    });

    return ACTION(() => C.astFactory.wrap(quads, C.astFactory.sourceLocation(quads.at(0), last)));
  },
  gImpl: ({ SUBRULE }) => (ast, { astFactory: F }) => {
    for (const quads of ast.val) {
      if (F.isGraphQuads(quads)) {
        SUBRULE(g11.quadsNotTriples, <T11.GraphQuads> quads);
      } else {
        SUBRULE(g11.triplesBlock, <T11.PatternBgp> quads);
      }
    }
  },
};

/**
 * OVERRIDING RULE: {@link g11.constructTemplate}.
 * Production `ConstructTemplate ::= '{' ConstructQuads '}'`.
 */
export const constructTemplate: SparqlGrammarRule<'constructTemplate', Wrap<ConstructTemplate>> = <const> {
  name: 'constructTemplate',
  impl: ({ ACTION, SUBRULE, CONSUME1, CONSUME2 }) => (C) => {
    const open = CONSUME1(l11.symbols.LCurly);
    const quads = SUBRULE(constructQuads);
    const close = CONSUME2(l11.symbols.RCurly);
    return ACTION(() => C.astFactory.wrap(quads.val, C.astFactory.sourceLocation(open, close)));
  },
};

const originalConstructQuery = sparql12ParserBuilder.getRule('constructQuery');

/**
 * OVERRIDING RULE: {@link g11.constructQuery}.
 *
 * Parsing wraps the original rule, which gets its template from the patched {@link constructTemplate}.
 * For the short form `CONSTRUCT WHERE { ... }`, the WHERE clause is derived from the template,
 * translating `GRAPH` blocks to `GRAPH` graph patterns.
 * Like any group graph pattern, that WHERE clause cannot reuse a blank node label across its basic graph patterns.
 */
export const constructQuery: SparqlRule<'constructQuery', ConstructQueryBody> = <const> {
  name: 'constructQuery',
  impl: $ => (C) => {
    const result = <ConstructQueryBody> <unknown> originalConstructQuery.impl($)(C);
    const shortFormPatterns = $.ACTION(() => {
      // In the short form, the original rule builds the WHERE clause as a group holding the template.
      // That template now is a list of quads instead of a BGP: replace it by the equivalent graph patterns.
      const where = result.where;
      if (where.patterns.length === 1 && Array.isArray(where.patterns[0])) {
        where.patterns = constructTemplateToPatterns(C.astFactory, result.template);
        return where.patterns;
      }
      return undefined;
    });
    $.SUBRULE(g11.validateGroupGraphPattern, <T11.Pattern[]> (shortFormPatterns ?? []));
    return result;
  },
  gImpl: ({ SUBRULE, PRINT_WORD, PRINT_ON_EMPTY, PRINT_ON_OWN_LINE, NEW_LINE }) => (ast, C) => {
    const { astFactory: F, indentInc } = C;
    const shortForm = F.isSourceLocationNoMaterialize(ast.where.loc);
    F.printFilter(ast, () => PRINT_ON_EMPTY('CONSTRUCT '));
    if (!shortForm) {
      F.printFilter(ast, () => {
        C[traqulaIndentation] += indentInc;
        PRINT_WORD('{');
        NEW_LINE();
      });
      SUBRULE(constructQuads, F.wrap(ast.template, templateLocation(F, ast)));
      F.printFilter(ast, () => {
        C[traqulaIndentation] -= indentInc;
        PRINT_ON_OWN_LINE('}');
      });
    }
    SUBRULE(g11.datasetClauseStar, ast.datasets);
    if (shortForm) {
      // The template is the WHERE clause.
      const loc = templateLocation(F, ast);
      const patterns = <T11.Pattern[]> constructTemplateToPatterns(F, ast.template);
      SUBRULE(g11.whereClause, F.wrap(F.patternGroup(patterns, loc), loc));
    } else {
      SUBRULE(g11.whereClause, F.wrap(<T11.PatternGroup> ast.where, ast.where.loc));
    }
    SUBRULE(g11.solutionModifier, <T11.SolutionModifiers> ast.solutionModifiers);
  },
};

/**
 * The location representing the quads of the template, from its first to its last element.
 * An empty template has no node to relate to the source:
 * it is auto generated when the query itself is printed, and left to the source of the query otherwise.
 */
function templateLocation(F: AstFactory, ast: ConstructQueryBody): SourceLocation {
  if (ast.template.length > 0) {
    return F.sourceLocation(...ast.template);
  }
  return F.isPrintingLoc(ast.loc) ? F.gen() : F.sourceLocationNoMaterialize();
}
