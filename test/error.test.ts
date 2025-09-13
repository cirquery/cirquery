// test/error.test.ts

import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser';
import { normalize } from '../src/cir/normalize';
import { buildPredicate } from '../src/cir/evaluator';
import { cirToSql } from '../src/adapters/sqlite';
import {
  ParseError,
  NormalizeError,
  EvaluationError,
  AdapterError,
} from '../src/errors/errors';

describe('[F-3] Error Handling', () => {
  describe('Parser (ParseError)', () => {
    // ★修正: E_PARSE_UNEXPECTED_TOKEN は字句解析レベルのエラーでテストする
    it('E_PARSE_UNEXPECTED_TOKEN: 未知の文字で失敗する', () => {
      const query = 'name = `'; // どのトークンにもマッチしない文字
      try {
        parse(query);
        expect.fail('ParseError was not thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ParseError);
        expect(e.code).toBe('E_PARSE_UNEXPECTED_TOKEN');
        expect(e.message).toContain('unexpected character');
      }
    });

    // ★修正: 構文エラーは E_PARSE_GENERIC で検証する
    it('E_PARSE_GENERIC: 構文的に正しくないトークンの配置で失敗する', () => {
      const query = 'name = >';
      try {
        parse(query);
        expect.fail('ParseError was not thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ParseError);
        expect(e.code).toBe('E_PARSE_GENERIC');
        // メッセージは "Mismatched" や "Expecting" となるが、"unexpected" は含まない
        expect(e.message).not.toContain('unexpected token');
      }
    });

    it('E_PARSE_GENERIC: 閉じ括弧がない場合に失敗する', () => {
      const query = '(name = "test"';
      try {
        parse(query);
        expect.fail('ParseError was not thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ParseError);
        expect(e.code).toBe('E_PARSE_GENERIC');
        // ★修正: Chevrotain の具体的なメッセージに合わせる
        expect(e.message).toContain('Expecting token of type --> RParen');
      }
    });
  });


  describe('Normalizer (NormalizeError)', () => {
    it('E_NORMALIZE_UNSUPPORTED_NODE: 未対応ノードで失敗する', () => {
      // any() の第1引数は path である必要がある
      const query = 'any(123, name:"A")';
      try {
        const { ast } = parse(query);
        normalize(ast);
        expect.fail('NormalizeError was not thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(NormalizeError);
        expect(e.code).toBe('E_NORMALIZE_UNSUPPORTED_NODE');
        expect(e.message).toContain('Unsupported node type for Quantified path: NumberLiteral');
      }
    });
  });

  describe('Evaluator (EvaluationError)', () => {
    it('E_EVAL_TYPE_MISMATCH: 型の不一致で失敗する', () => {
      const query = 'year > "2020"'; // number と string の比較
      const record = { year: 2021 };
      try {
        const { ast } = parse(query);
        const cir = normalize(ast);
        const predicate = buildPredicate(cir);
        predicate(record);
        expect.fail('EvaluationError was not thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(EvaluationError);
        expect(e.code).toBe('E_EVAL_TYPE_MISMATCH');
        expect(e.message).toContain("Type mismatch for 'gt': expected number|string, got number/string");
      }
    });
  });

  describe('Adapter (AdapterError)', () => {
    it('E_ADAPTER_UNSUPPORTED_FEATURE: 未対応の機能で失敗する', () => {
      // ★テストのために未対応の"some"を使ったCIRを意図的に作成する
      const unsupportedCir = {
        type: 'Quantified',
        quantifier: 'some', // 意図的に未対応の量化子を使用
        path: { type: 'Path', segments: ['ingredients'] },
        predicate: {
          type: 'Comparison',
          path: { type: 'Path', segments: ['alcohol_content'] },
          op: 'gt',
          value: { type: 'NumberLiteral', value: 0 },
        },
      };
  
      try {
        // このCIRノードがAdapterErrorを引き起こすはず
        cirToSql(unsupportedCir as any);
        expect.fail('AdapterError was not thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(AdapterError);
        expect(e.code).toBe('E_ADAPTER_UNSUPPORTED_FEATURE');
        // 正しいエラーメッセージを検証
        expect(e.message).toContain('Unsupported quantifier in sqlite adapter: some');
      }
    });
  });

});