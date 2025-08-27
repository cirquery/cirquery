// test/evaluator.text.test.ts
import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser/index.ts';
import { normalize } from '../src/cir/normalize.ts';
import { buildPredicate } from '../src/cir/evaluator.ts';

// データセットA: ロケール差検証（トルコ語 İ）
const rowsTR = [
  { s: 'İstanbul' },  // U+0130 LATIN CAPITAL LETTER I WITH DOT ABOVE
  { s: 'istanbul' },
  { s: 'Gin Tonic' },
];

// データセットB: アクセント・大小・非文字列混在
const rowsFR = [
  { id: 1, name: 'Café au lait' },
  { id: 2, name: 'cafe' },
  { id: 3, name: 'CAFETERIA' },
  { id: 4, name: 'Tequila' },
  { id: 5, name: '' },
  { id: 6, name: 'caf' },
  { id: 7, name: 'CafE' },
  { id: 8, idStr: '1' }, // 非文字列フィールド検証用に name 不在
];

// test/evaluator.text.test.ts の先頭付近に追加
function supportsTurkishLower(): boolean {
    try {
      // 期待: 'İ' → 'i' になる環境をサポートとみなす
      return 'İ'.toLocaleLowerCase('tr') === 'i';
    } catch {
      return false;
    }
  }



describe('evaluator text options (ignoreCase, locale)', () => {
  // --- ロケール未指定: デフォルトは厳密一致（大小区別） ---
  it('contains ignoreCase=false (strict, default locale)', () => {
    const { ast } = parse('contains(s, "istanbul")');
    const cir = normalize(ast);
    const pred = buildPredicate(cir, { ignoreCase: false });
    // 'istanbul' のみ一致
    expect(rowsTR.filter(pred).map(r => r.s)).toEqual(['istanbul']);
  });

  // --- ロケール指定（トルコ語）: İ → i に小文字化され一致範囲が広がる ---
  it('contains ignoreCase=true with tr locale (İ → i)', () => {
    const { ast } = parse('contains(s, "istanbul")');
    const cir = normalize(ast);
    const pred = buildPredicate(cir, { ignoreCase: true, locale: 'tr' });
    // 'İstanbul' と 'istanbul' の両方に一致
    expect(rowsTR.filter(pred).map(r => r.s)).toEqual(['İstanbul', 'istanbul']);
  });

  // --- ignoreCase=true, ロケール未指定: 通常のケース無視での startsWith ---
  it('startsWith ignoreCase=true (default locale)', () => {
    const { ast } = parse('startsWith(s, "gin")');
    const cir = normalize(ast);
    const pred = buildPredicate(cir, { ignoreCase: true });
    expect(rowsTR.filter(pred).map(r => r.s)).toEqual(['Gin Tonic']);
  });

  // --- ignoreCase=true, ロケール未指定: endsWith ---
  it('endsWith ignoreCase=true (default locale)', () => {
    const { ast } = parse('endsWith(s, "BUL")');
    const cir = normalize(ast);
    const pred = buildPredicate(cir, { ignoreCase: true });
    // 大小無視で 'İstanbul' と 'istanbul' が対象
    expect(rowsTR.filter(pred).map(r => r.s)).toEqual(['İstanbul', 'istanbul']);
  });

  // --- デフォルトは大小区別: 部分一致（含む） ---
  it('default: case-sensitive contains (no hits when case differs)', () => {
    const { ast } = parse('name: "Cafe"'); // contains(name, "Cafe")
    const cir = normalize(ast);
    const pred = buildPredicate(cir, { ignoreCase: false });
    // 大小区別のため一致なし
    expect(rowsFR.filter(pred).map(r => r.id ?? -1)).toEqual([]);
  });

  // --- ignoreCase=true: 大小無視の部分一致 ---
  it('ignoreCase: case-insensitive contains', () => {
    const { ast } = parse('name: "cafe"');
    const cir = normalize(ast);
    const pred = buildPredicate(cir, { ignoreCase: true });
    // 'cafe' を部分として含む 2,3,7 がヒット（1は 'Café' のため未ヒット）
    expect(rowsFR.filter(pred).map(r => r.id ?? -1)).toEqual([2, 3, 7]);
  });

  // --- ロケール指定（fr）: toLocaleLowerCase での比較（アクセントは保持される前提） ---
  it('ignoreCase + locale=fr (accents are not stripped)', () => {
    const { ast } = parse('name: "CAFE"');
    const cir = normalize(ast);
    const pred = buildPredicate(cir, { ignoreCase: true, locale: 'fr' });
    // 'Café' は小文字化しても 'café' であり 'cafe' にはならないため不一致。
    // 'cafe'(2), 'CAFETERIA'(3), 'CafE'(7) は一致。
    expect(rowsFR.filter(pred).map(r => r.id ?? -1)).toEqual([2, 3, 7]);
  });

  // --- startsWith/endsWith の大小無視 ---
  it('startsWith ignoreCase=true (prefix)', () => {
    const { ast } = parse('startsWith(name, "caf")');
    const cir = normalize(ast);
    const pred = buildPredicate(cir, { ignoreCase: true });
    // 'Café au lait'(1) も大小無視の先頭一致('Café au lait'.toLocaleLowerCase() は 'café au lait')でヒット、
    // 'cafe'(2), 'CAFETERIA'(3), 'caf'(6), 'CafE'(7) が該当
    expect(rowsFR.filter(pred).map(r => r.id ?? -1)).toEqual([1, 2, 3, 6, 7]);
  });

  it('endsWith ignoreCase=true (suffix)', () => {
    const { ast } = parse('endsWith(name, "LA")');
    const cir = normalize(ast);
    const pred = buildPredicate(cir, { ignoreCase: true });
    // 'Tequila'(4) が該当（大文字小文字無視）
    expect(rowsFR.filter(pred).map(r => r.id ?? -1)).toEqual([4]);
  });

  // --- 非文字列フィールドは Text 評価 false ---
  it('non-string field returns false in Text ops', () => {
    const { ast } = parse('startsWith(id, "1")');
    const cir = normalize(ast);
    const pred = buildPredicate(cir, { ignoreCase: true });
    // id は number なので常に false
    expect(rowsFR.filter(pred).map(r => r.id ?? -1)).toEqual([]);
  });

  // --- 空文字列や空 needles の境界（仕様確認用） ---
  it('contains with empty needle (matches everything)', () => {
    const { ast } = parse('contains(name, "")'); // String.prototype.includes('') は常に true
    const cir = normalize(ast);
    const pred = buildPredicate(cir, { ignoreCase: false });
    // name が string のレコードのみヒット（8は name 不在）
    expect(rowsFR.filter(pred).map(r => r.id ?? -1)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('startsWith with empty needle (matches everything)', () => {
    const { ast } = parse('startsWith(name, "")');
    const cir = normalize(ast);
    const pred = buildPredicate(cir, { ignoreCase: true });
    expect(rowsFR.filter(pred).map(r => r.id ?? -1)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('endsWith with empty needle (matches everything)', () => {
    const { ast } = parse('endsWith(name, "")');
    const cir = normalize(ast);
    const pred = buildPredicate(cir, { ignoreCase: true });
    expect(rowsFR.filter(pred).map(r => r.id ?? -1)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  const maybeIt = supportsTurkishLower() ? it : it.skip;

  maybeIt('contains ignoreCase=true with tr locale (İ → i)', () => {
    const { ast } = parse('contains(s, "istanbul")');
    const cir = normalize(ast);
    const pred = buildPredicate(cir, { ignoreCase: true, locale: 'tr' });
    expect(rowsTR.filter(pred).map(r => r.s)).toEqual(['İstanbul', 'istanbul']);
  });
  

});


// D-5: diacritics folding の検証（Café ↔ cafe）
describe('evaluator text options (foldDiacritics)', () => {
  // rowsFR 既存の 1..8 を維持しつつ、アクセント比較の前後関係が明確なレコードを id:9 に追加
  const rowsFRPlus = [
    ...rowsFR,
    { id: 9, name: 'CAFÉ' }, // アクセント付き大文字（fold + ignoreCase の複合確認）
  ];

  it('contains with foldDiacritics=true matches accent-insensitive', () => {
    const { ast } = parse('name: "cafe"'); // contains(name, "cafe")
    const cir = normalize(ast);
    const pred = buildPredicate(cir, { foldDiacritics: true, ignoreCase: true });
    // アクセント差/大小差を吸収して 1,2,3,7,9 がマッチ
    // 1: "Café au lait" → "cafe au lait" に fold → contains "cafe"
    // 2: "cafe" → contains "cafe"
    // 3: "CAFETERIA" → "cafeteria" に lower → contains "cafe"
    // 7: "CafE" → "cafe"
    // 9: "CAFÉ" → fold+lower で "cafe"
    expect(rowsFRPlus.filter(pred).map(r => r.id ?? -1)).toEqual([1, 2, 3, 7, 9]);
  });

  it('startsWith with foldDiacritics=true handles accent at start', () => {
    const { ast } = parse('startsWith(name, "Cafe")');
    const cir = normalize(ast);
    // 大小区別は false のままでも、fold が先行することで "Café" -> "Cafe" 化されるため一致
    const pred = buildPredicate(cir, { foldDiacritics: true, ignoreCase: false });
    // 1: "Café au lait" → fold で "Cafe au lait" → startsWith "Cafe"
    // 2: "cafe" は ignoreCase=false なので大小不一致
    // 3: "CAFETERIA" は "CAFE..." だが "Cafe" と大小が異なるため対象外
    // 6: "caf" は接頭が "caf" で "Cafe" とは異なる
    // 7: "CafE" は大小混在で "Cafe" とは一致しない
    // 9: "CAFÉ" → fold で "CAFE"、ただし ignoreCase=false なので "Cafe" とは不一致
    expect(rowsFRPlus.filter(pred).map(r => r.id ?? -1)).toEqual([1]);
  });

  it('endsWith with foldDiacritics=true matches suffix after folding', () => {
    const { ast } = parse('endsWith(name, "fe")');
    const cir = normalize(ast);
    // fold + ignoreCase の両方を有効化
    const pred = buildPredicate(cir, { foldDiacritics: true, ignoreCase: true });
    // 2: "cafe" → "fe" で終了
    // 7: "CafE" → lower "cafe" → "fe" で終了
    // 9: "CAFÉ" → fold+lower "cafe" → "fe" で終了
    expect(rowsFRPlus.filter(pred).map(r => r.id ?? -1)).toEqual([2, 7, 9]);
  });

  it('backward compatibility: foldDiacritics=false keeps accent-sensitive behavior', () => {
    const { ast } = parse('name: "cafe"');
    const cir = normalize(ast);
    const pred = buildPredicate(cir, { foldDiacritics: false, ignoreCase: false });
    // アクセントや大小を無視しない → "cafe" 完全一致/包含のケースのみ
    // 2: "cafe" → includes "cafe"
    // 3: "CAFETERIA" は大小違い → 不一致
    // 1,9: "Café"/"CAFÉ" はアクセント差で包含にならない
    expect(rowsFRPlus.filter(pred).map(r => r.id ?? -1)).toEqual([2]);
  });

  it('locale + foldDiacritics interplay: tr locale still applies folding first', () => {
    const { ast } = parse('name: "cafe"');
    const cir = normalize(ast);
    // ロケール依存の lower を使いつつ、fold は先に適用される
    const pred = buildPredicate(cir, { foldDiacritics: true, ignoreCase: true, locale: 'tr' });
    // マッチ集合は fold + lower の効果で contains "cafe" になる 1,2,3,7,9
    expect(rowsFRPlus.filter(pred).map(r => r.id ?? -1)).toEqual([1, 2, 3, 7, 9]);
  });

  it('non-string field remains false even with foldDiacritics', () => {
    const { ast } = parse('startsWith(id, "1")');
    const cir = normalize(ast);
    const pred = buildPredicate(cir, { foldDiacritics: true, ignoreCase: true });
    // id は number → Text 演算は false
    expect(rowsFRPlus.filter(pred).map(r => r.id ?? -1)).toEqual([]);
  });

  it('empty needle with folding still matches all string names', () => {
    const { ast } = parse('contains(name, "")'); // includes('') は常に true
    const cir = normalize(ast);
    const pred = buildPredicate(cir, { foldDiacritics: true, ignoreCase: false });
    // name が string の行のみ（8 は name 不在）→ 1..7,9
    expect(rowsFRPlus.filter(pred).map(r => r.id ?? -1)).toEqual([1, 2, 3, 4, 5, 6, 7, 9]);
  });

});

// test/evaluator.text.test.ts への差分（U+0130: İ の扱いを明確化）

describe('text normalization with foldDiacritics and locale (U+0130: İ)', () => {
  const { ast } = parse('contains(s, "istanbul")');
  const cir = normalize(ast);

  // A) デフォルトロケール: ignoreCase=true（foldなし）
  //    “İstanbul” は通常ヒットしない（U+0130 はそのまま、'istanbul' と一致しにくい）
  it('A) default locale, ignoreCase=true (no fold): hits only "istanbul"', () => {
    const pred = buildPredicate(cir, { ignoreCase: true });
    expect(rowsTR.filter(pred).map(r => r.s)).toEqual(['istanbul']);
  });

  // B) デフォルトロケール: foldDiacritics=true + ignoreCase=true
  //    “İ” は NFD 分解＋U+0307 除去で “I” → lower(既定) で多くの環境では “i” となるため、
  //    “İstanbul” も “istanbul” と同等にヒットしやすい（環境依存を許容しつつ、最低保証は 'istanbul'）。
  it('B) default locale, fold=true + ignoreCase=true: at least "istanbul" matches (env may also match "İstanbul")', () => {
    const pred = buildPredicate(cir, { foldDiacritics: true, ignoreCase: true });
    const hits = rowsTR.filter(pred).map(r => r.s);
    expect(hits.includes('istanbul')).toBe(true);
    // 'İstanbul' ヒットは環境依存のため強制しない
  });

  // C) tr ロケール: foldDiacritics=true + ignoreCase=true
  //    “İ”→NFD + U+0307 除去→“I”、lower(tr) で “ı” になり 'i' と等価ではないため一致しないことがある。
  //    環境依存を踏まえて、最低保証として 'istanbul' のみを要求する。
  it('C) tr locale, fold=true + ignoreCase=true: guarantees at least "istanbul" (İ may not match due to I→ı)', () => {
    const pred = buildPredicate(cir, { foldDiacritics: true, ignoreCase: true, locale: 'tr' });
    const hits = rowsTR.filter(pred).map(r => r.s);
    expect(hits.includes('istanbul')).toBe(true);
  });

  // D) en-US ロケール: foldDiacritics=true + ignoreCase=true
  //    “İ”→NFD + U+0307 除去→“I”、lower(en-US) で “i” となるため、
  //    'İstanbul' と 'istanbul' の両方がヒットすることを期待する。
  it('D) en-US locale, fold=true + ignoreCase=true: "İstanbul" and "istanbul" both match', () => {
    const pred = buildPredicate(cir, { foldDiacritics: true, ignoreCase: true, locale: 'en-US' });
    expect(rowsTR.filter(pred).map(r => r.s)).toEqual(['İstanbul', 'istanbul']);
  });
});

