# sparql-construct-quads

Extension of SPARQL CONSTRUCT syntax allowing quads in the template.

This package extends the [Traqula](https://github.com/comunica/traqula) SPARQL 1.2 parser, generator and algebra
translations so that a CONSTRUCT template can contain `GRAPH` blocks, next to the usual default-graph triples:

```sparql
PREFIX ex: <http://example.org/>
CONSTRUCT {
  ?s a ex:Resource .                 # triple in the default graph
  GRAPH ex:index { ?s ex:in ?g } .   # triples in a named graph
  GRAPH ?g { ?s ?p ?o }              # triples in a graph bound by the WHERE clause
}
WHERE { GRAPH ?g { ?s ?p ?o } }
```

## Grammar

The extension changes two productions of the [SPARQL 1.2 grammar](https://www.w3.org/TR/sparql12-query/#sparqlGrammar),
reusing `QuadsNotTriples` from SPARQL Update:

```ebnf
ConstructTemplate ::= '{' ConstructQuads '}'
ConstructQuads    ::= ConstructTriples? ( QuadsNotTriples '.'? ConstructTriples? )*
QuadsNotTriples   ::= 'GRAPH' VarOrIri '{' TriplesTemplate? '}'
```

The template's syntax is therefore the same as the quads of `INSERT { ... }`.
Because the short form `CONSTRUCT WHERE { ... }` also uses `ConstructTemplate`, it accepts `GRAPH` blocks too:
`CONSTRUCT WHERE { ?s ?p ?o GRAPH ?g { ?s ?q ?x } }` uses its template as the WHERE clause
`{ ?s ?p ?o GRAPH ?g { ?s ?q ?x } }`.
As in any group graph pattern, that short form cannot reuse a blank node label across its basic graph patterns.
In the long form, a blank node label used in several graphs of the template refers to the same fresh blank node
for each solution.

All other SPARQL 1.2 syntax is parsed, generated and translated exactly as by Traqula.
The test suite runs Traqula's own parser, generator and algebra test suites against the extension to check this.

## Usage

```typescript
import { Generator, Parser, toAlgebra, toAst } from 'sparql-construct-quads';

const parser = new Parser();
const ast = parser.parse(`
  CONSTRUCT { ?s ?p ?o . GRAPH ?g { ?s ?p ?o } }
  WHERE { GRAPH ?g { ?s ?p ?o } }`);

const algebra = toAlgebra(ast);         // SPARQL algebra, with quad patterns in the CONSTRUCT template
const sameAst = toAst(algebra);         // back to an AST
const query = new Generator().generate(sameAst);
```

`Parser`, `Generator`, `toAlgebra` and `toAst` take the same options as their counterparts in
`@traqula/parser-sparql-1-2`, `@traqula/generator-sparql-1-2` and `@traqula/algebra-sparql-1-2`.
To round-trip a query while keeping its original formatting, parse it with a source-tracking `AstFactory`,
as described in the
[Traqula documentation](https://github.com/comunica/traqula/blob/main/engines/parser-sparql-1-2/README.md).

### AST

The `template` of a CONSTRUCT query (`QueryConstruct`) is a list of quads (`Quads[]`),
the same representation SPARQL 1.2 Update uses for `insert` and `delete`:

* a `PatternBgp` (`{ type: 'pattern', subType: 'bgp', triples }`) for triples in the default graph,
* a `GraphQuads` (`{ type: 'graph', graph, triples }`) for a `GRAPH` block, with `graph` an IRI or a variable.

The elements keep the order in which they appear in the query.
For the query above, the template is `[ bgp(?s ?p ?o), graph(?g, bgp(?s ?p ?o)) ]`.
A template without `GRAPH` blocks is a list holding a single BGP, and an empty template is an empty list.
Upstream Traqula has a single `PatternBgp` as template instead.

For the short form `CONSTRUCT WHERE`, the `where` clause holds the patterns of the template,
with each `GRAPH` block as a `GRAPH` graph pattern (`PatternGraph`), and does not materialize in the query string.

### Algebra

The [CONSTRUCT operation](https://www.w3.org/TR/sparql12-query/#construct) already has quad patterns as template.
Triples in the default graph get the default graph as `graph`,
triples in `GRAPH <g> { ... }` get `<g>`, which can also be a variable:

```typescript
{
  type: 'construct',
  input: { type: 'graph', name: ?g, input: { type: 'bgp', patterns: [ ?s ?p ?o ] } },
  template: [ pattern(?s, ?p, ?o, defaultGraph), pattern(?s, ?p, ?o, ?g) ],
}
```

The algebra of a template without `GRAPH` blocks is the same as in SPARQL 1.2.
Translating algebra back to an AST groups consecutive patterns of the same graph:
patterns in the default graph become a BGP, others a `GRAPH` block.

## Extending

Following the [Traqula guidelines](https://github.com/comunica/traqula/blob/main/docs/guidelines.md),
the package exports its building blocks, so the extension can be combined with other grammar changes:

| Export                            | Description                                                                                       |
|-----------------------------------|---------------------------------------------------------------------------------------------------|
| `constructQuadsParserBuilder`     | `ParserBuilder` extending `sparql12ParserBuilder`                                                 |
| `constructQuadsGeneratorBuilder`  | `GeneratorBuilder` extending `sparql12GeneratorBuilder`                                           |
| `constructQuadsToAlgebraBuilder`  | `IndirBuilder` extending `toAlgebra12Builder`                                                     |
| `constructQuadsToAstBuilder`      | `IndirBuilder` extending `toAst12Builder`                                                         |
| `gram.constructQuads`             | new rule `ConstructQuads` (parsing and generation)                                                |
| `gram.constructTemplate`          | patch of `constructTemplate`, returning the quads                                                 |
| `gram.constructQuery`             | patch of `constructQuery`, wrapping the original parser rule                                      |
| `translateConstructTemplate`      | new transformation from the template quads to algebra quad patterns                               |
| `translateAggregatesConstructQuads` | patch of `translateAggregates`, wrapping the original to fill in the quad patterns              |
| `translateAlgConstructTemplate`   | new transformation from algebra quad patterns to template quads                                   |
| `translateAlgProjectConstructQuads` | patch of `translateProject`, wrapping the original to translate the quad patterns              |
| `QueryConstruct`, `Query`, `SparqlQuery`, `ConstructTemplate` | AST types                                             |

Copy a builder before modifying it, for example `ParserBuilder.create(constructQuadsParserBuilder)`.

## Development

```bash
npm ci
npm test            # this extension's tests and Traqula's test suites
npm run typecheck
npm run build       # emits dist/
```

The Traqula packages are pinned with tilde ranges (`~1.5.0-alpha.x`):
minor versions of Traqula can change how existing rules call each other, so check the changelog before upgrading.
