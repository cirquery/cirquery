# cirquery

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/cirquery.svg)](https://www.npmjs.com/package/cirquery)

**Read this in other languages:** [日本語](README.ja.md)

---

**cirquery** (Canonical Intermediate Representation Query) is a TypeScript library that provides a human-friendly query DSL for filtering JSON data, with a common intermediate representation (CIR) that can be adapted to multiple backends.

## 🔬 JSON Playground

Try cirquery instantly in your browser—no installation required.  
Drag and drop your JSON files and execute queries in real-time.

[![Playground](https://img.shields.io/badge/Playground-Open-blue)](https://cirquery.github.io/cirquery/)

👉 **[Launch Playground](https://cirquery.github.io/cirquery/)**

## ✨ Features

- **Human-Readable Query Language**: Write intuitive search queries with natural syntax
- **Common Intermediate Representation (CIR)**: Normalize queries into a backend-agnostic format for reusability
- **Type-Safe**: Fully typed TypeScript implementation
- **Extensible**: Easily add custom adapters or field search capabilities
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

## 🎯 Roadmap

### v0.1 (Completed)
- [x] Basic DSL syntax (logical operations, comparisons, text search, quantifiers)
- [x] CIR normalization (De Morgan's laws, NOT optimization)
- [x] JavaScript evaluator
- [x] Accent folding & case normalization

### v0.2 (Current)
- [x] Multi-level array path shorthand support

### v0.3 (Planned)
- [ ] Explicit OR/AND in ValueList
- [ ] Full-field search (ANYFIELD)
- [ ] Additional backend adapters (MongoDB, SQLite)

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
