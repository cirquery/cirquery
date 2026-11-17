# cirquery

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/cirquery.svg)](https://www.npmjs.com/package/cirquery)

**Read this in other languages:** [日本語](README.ja.md)

---

**cirquery** (Canonical Intermediate Representation Query) is a TypeScript library that compiles a human-friendly filter DSL into a canonical intermediate representation (CIR) — a normalized, backend-agnostic form of your query. The same query runs in memory, and adapts to SQLite, MongoDB, and Elasticsearch, with identical results where it matters: a conformance test suite proves the in-memory evaluator and the SQLite adapter return exactly the same rows for the same queries.

## 🔬 JSON Playground

Try cirquery instantly in your browser—no installation required.  
Drag and drop your JSON files and execute queries in real-time.

[![Playground](https://img.shields.io/badge/Playground-Open-blue)](https://cirquery.github.io/cirquery/)

👉 **[Launch Playground](https://cirquery.github.io/cirquery/)**

## ✨ Features

- **Human-Readable Query Language**: Write intuitive search queries with natural syntax — the same text a person types into a search box, or an LLM generates
- **Common Intermediate Representation (CIR)**: Queries are normalized (De Morgan push-down, flattening, canonical forms), so two differently-written queries with the same meaning produce the same CIR — hashable, cacheable, and validatable against a closed operator set before anything touches a database
- **Arithmetic in Filters**: `price * qty >= 1000`, `(price + tax) / 2 < 500`, `qty % 3 = 0`, even field-to-field comparisons (`price > cost`)
- **Backend Adapters**: Reference adapters in this repo compile CIR to SQLite (JSON document columns), MongoDB filters, and Elasticsearch bool/filter queries — relevance scoring is deliberately out of scope
- **Conformance-Tested**: The same fixture data and query corpus run against the in-memory evaluator and a real SQLite database, and must return identical results
- **Type-Safe**: Fully typed TypeScript implementation
- **Multi-Language Support**: Built-in accent folding and case normalization

## 🚀 Installation

### From npm

```
npm install cirquery
```

- npm package: [cirquery@npm](https://www.npmjs.com/package/cirquery)

For local development and testing, see the **🛠️ Development** section below.

## 📖 Quick Start

### Query Syntax Examples

cirquery uses an intuitive DSL (Domain-Specific Language) to query JSON data. Here are common patterns:

#### Basic Logical Operations

Supports equality (`=`), inequality (`!=`), numeric comparisons (`<`, `>`, `<=`, `>=`), and logical operators (`AND`, `OR`).

`category = "drink" AND price < 10`  
`is_alcoholic = true OR contains_citrus = true`

#### Text Search

Use colon (`:`) as shorthand for `contains`:

`name:"Tonic"`

Use function syntax for prefix/suffix matching:

`startsWith(name, "Gin")`  
`endsWith(garnish, "peel")`


#### Array Quantifiers

Query array elements with `any` (at least one element matches) or `all` (all elements match):

`any(ingredients, name = "rum")`
`all(ingredients, type = "spirit")`

Access nested properties with dot notation:

`ingredients.name:"gin"`

#### Negation and Grouping

Use `NOT` for negation and parentheses `()` for precedence:

`NOT (year >= 2000)`  
`is_alcoholic = false OR (type = "spirit" AND NOT is_carbonated = true)`

#### Arithmetic Filters

Comparisons can compute on both sides:

`price * qty >= 1000`  
`(unit_price + tax) * qty < 5000`  
`qty % 3 = 0 AND price > cost`

### JavaScript/TypeScript Usage

```typescript
import { parse, normalize, buildPredicate } from 'cirquery';

// Parse DSL and normalize to CIR
const { ast } = parse('category = "cocktail" AND price < 15');
const cir = normalize(ast);

// Generate predicate function from CIR
const predicate = buildPredicate(cir);

// Filter data
const data = [
  { category: 'cocktail', price: 12, name: 'Mojito' },
  { category: 'wine', price: 20, name: 'Chardonnay' }
];

const results = data.filter(predicate);
console.log(results); // [{ category: 'cocktail', price: 12, name: 'Mojito' }]
```

### CLI Usage

```
# Launch REPL
npx cirquery

# Query from stdin
echo '{"name":"test","category":"drink"}' | npx cirquery 'category = "drink"'
```

## 📚 Documentation

- [DSL Syntax Reference](docs/spec/dsl.md) - Detailed query language syntax
- [CIR Specification](docs/spec/ast-cir.md) - Intermediate representation types
- [Normalization Design](docs/design/normalization.md) - DSL to CIR conversion rules
- [Examples](examples/README.md) - Practical query examples

## 🛠️ Development

### Prerequisites

- Node.js 22+
- npm or pnpm

### Setup

```
git clone https://github.com/cirquery/cirquery.git
cd cirquery
npm install
npm run build
npm test
```

### Local Development Methods

For contributors who want to test locally or develop new features:

#### Method A: npm link (Recommended)

1. Create link in repository root:
   ```
   npm ci
   npm run build
   npm link
   ```

2. Link from your project:
   ```
   npm link cirquery
   ```

3. Import as usual:
   ```
   import 'cirquery';
   ```

Unlink:
```
npm unlink cirquery && npm unlink --global cirquery
```

#### Method B: Relative Install (Simple)

```
npm install /absolute/path/to/cirquery
```

Note: This includes all source files. For production-like testing, use Method A.

#### Method C: Pack and Install (Production-like)

1. Generate tarball:
   ```
   npm run build
   npm pack
   ```

2. Install in your project:
   ```
   npm install /path/to/cirquery-0.2.1.tgz
   ```

### Directory Structure

```
├── src/                 # Source code
│   ├── parser/          # DSL parser
│   ├── cir/            # CIR normalization & evaluation
│   ├── cli/            # CLI tool
│   └── adapters/       # Backend adapters
├── test/               # Tests
├── docs/               # Documentation
├── examples/           # Sample data & queries
└── scripts/            # Development scripts
```

### Scripts

- `npm run build` - Build TypeScript (ESM/CJS)
- `npm test` - Run tests
- `npm run typecheck` - Type checking
- `npm run lint` - Run ESLint
- `npm run format` - Format with Prettier

## 🔧 Architecture

```
[DSL] → [Parser] → [AST] → [Normalize] → [CIR] → [Evaluator/Adapters]
```

1. **DSL**: Human-friendly query language
2. **Parser**: Parse DSL into Abstract Syntax Tree (AST)
3. **Normalize**: Transform AST into Common Intermediate Representation (CIR)
4. **Evaluator/Adapters**: Execute CIR (JavaScript evaluation, DB conversion, etc.)

Adapters live in this repository as reference implementations (`src/adapters/`) and are intentionally not part of the published package API — see `docs/dev/adapters.md`.

### Why an intermediate representation?

Standards and frameworks already occupy parts of this space, at a different weight class:

| | Form | Scope | Weight |
|---|---|---|---|
| **cirquery** | Text DSL → normalized JSON IR | Filtering (incl. arithmetic), in-memory + SQL + search backends | An npm library that runs in the browser |
| OData `$filter` | URL query option | Entity services over REST; rich operators, but protocol-bound and unevenly implemented | A service framework |
| Apache Calcite | SQL → relational algebra | Full query planning/optimization across data sources | JVM infrastructure |
| Substrait | Protobuf plan spec | Analytics-engine plan exchange; no human-facing syntax | Engine internals |
| JsonLogic | JSON rules | In-memory rule evaluation only | A rule format |

cirquery's seat is the one left open: a small, canonical, testable filter IR for app developers — the thing a query builder UI serializes to, an LLM can safely generate, and a saved search can be re-executed against whichever backend the app grows into.

## 🎯 Roadmap

### v0.1 (Completed)
- [x] Basic DSL syntax (logical operations, comparisons, text search, quantifiers)
- [x] CIR normalization (De Morgan's laws, NOT optimization)
- [x] JavaScript evaluator
- [x] Accent folding & case normalization

### v0.2 (Completed)
- [x] Multi-level array path shorthand support

### v0.3 (Completed)
- [x] Arithmetic expressions in filters (`+ - * / %`, unary minus, field-to-field comparisons)
- [x] Backend adapters: SQLite (generic JSON-document model), MongoDB, Elasticsearch
- [x] Cross-backend conformance test suite (evaluator vs. real SQLite execution)
- [x] Full-field search via configured targets (`textSearchTargets` option with single-argument text functions)

### Future
- [ ] Explicit OR/AND in ValueList
- [ ] Projection / sorting in CIR
- [ ] Adapters as separate packages (`cirquery-adapter-*`) if demand appears

## 🤝 Contributing

Bug reports, feature requests, and pull requests are welcome!

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Create a Pull Request

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for details.

## 📄 License

This project is licensed under the [MIT License](LICENSE).

## 🙏 Acknowledgments

- [Chevrotain](https://github.com/Chevrotain/chevrotain) - Parser generator
- [Vitest](https://vitest.dev/) - Test framework
- [tsup](https://github.com/egoist/tsup) - TypeScript bundler

---

<div align="center">
Made with ❤️ for better data querying
</div>
