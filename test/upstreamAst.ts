/**
 * Converts an AST produced by the SPARQL 1.2 parser of Traqula to the AST this extension produces for the same query.
 * The only difference is the template of CONSTRUCT queries:
 * a BGP upstream, a list of quads (holding that BGP when it is not empty) here.
 * In the short form `CONSTRUCT WHERE { ... }`, the WHERE clause holds the same patterns as the template.
 */
export function toConstructQuadsAst<T>(ast: T): T {
  if (Array.isArray(ast)) {
    return <T> ast.map(element => toConstructQuadsAst(element));
  }
  if (typeof ast !== 'object' || ast === null) {
    return ast;
  }
  const copy: Record<string, unknown> = Object.fromEntries(
    Object.entries(ast).map(([ key, value ]) => [ key, toConstructQuadsAst(value) ]),
  );
  if (copy.type === 'query' && copy.subType === 'construct') {
    const template = <{ triples: unknown[] }> copy.template;
    copy.template = template.triples.length > 0 ? [ template ] : [];
    const where = <{ patterns: unknown[]; loc: { sourceLocationType: string } }> copy.where;
    if (where.loc.sourceLocationType === 'noMaterialize') {
      copy.where = { ...where, patterns: copy.template };
    }
  }
  return <T> copy;
}
