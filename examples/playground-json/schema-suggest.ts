// examples/playground-json/schema-suggest.tsS
// JSONスキーマ推定＋推奨クエリ生成（配列・オブジェクト・スカラー対応）
// ログとコメントを厚めにし、保守容易性を確保。

export type Row = Record<string, unknown>;

export interface PathStat {
  path: string; // 例: "cocktail.name", "cocktail.ingredients[]", "$"
  types: Record<string, number>; // { string: 100, number: 20, array: 5 } 等
  samples: unknown[]; // 代表値サンプル（最大N）
  uniqueApprox: number; // 近似ユニーク数（サンプル内）
  children?: Record<string, PathStat>; // オブジェクト/配列要素の子
}

export interface SchemaSummary {
  flat: PathStat[]; // フラットな一覧（UI表示用）
  byPath: Map<string, PathStat>; // 参照用インデックス
}

// ユーティリティ
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// スキーマ推定（サンプリングベース）
export function inferSchemaDetailed(rows: Row[], sampleSize = 300, samplePerPath = 8): SchemaSummary {
  const byPath = new Map<string, PathStat>();

  const addSample = (ps: PathStat, v: unknown) => {
    if (ps.samples.length < samplePerPath) ps.samples.push(v);
    const key = JSON.stringify(v);
    // ユニーク近似: サンプル内のユニーク数を数える簡易手法
    const uniq = new Set(ps.samples.map(x => JSON.stringify(x)));
    ps.uniqueApprox = uniq.size;
  };

  const bumpType = (ps: PathStat, t: string) => {
    ps.types[t] = (ps.types[t] ?? 0) + 1;
  };

  const ensurePath = (path: string): PathStat => {
    if (!byPath.has(path)) {
      byPath.set(path, { path, types: {}, samples: [], uniqueApprox: 0, children: undefined });
    }
    return byPath.get(path)!;
  };

  const visit = (path: string, v: unknown) => {
    const p = path || '$';
    const ps = ensurePath(p);
    const t = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
    bumpType(ps, t);
    addSample(ps, summarizeValue(v));

    if (Array.isArray(v)) {
      // 配列自体の統計
      for (const el of v) {
        // 要素のパスは "path[]" で表現
        visit(`${p}[]`, el);
      }
    } else if (isPlainObject(v)) {
      // オブジェクトの子を辿る
      for (const [k, val] of Object.entries(v)) {
        visit(p === '$' ? k : `${p}.${k}`, val);
      }
    }
  };

  // 値の要約（表示や contains 候補に使う）
  function summarizeValue(v: unknown): unknown {
    if (typeof v === 'string') {
      return v.length > 80 ? v.slice(0, 77) + '…' : v;
    }
    return v;
  }

  const take = rows.slice(0, sampleSize);
  for (const r of take) visit('', r);

  const flat = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  return { flat, byPath };
}

// 推奨クエリの生成
export interface Suggestion {
  label: string; // UI表示用
  query: string; // 実際に挿入するDSL
  rationale?: string; // 提案理由（デバッグ/ログ用）
}

function suggestionsForPath(ps: PathStat): Suggestion[] {
  const out: Suggestion[] = [];
  const has = (t: string) => (ps.types[t] ?? 0) > 0;

  // パスに含まれる "[]" をすべて取り除く
  const correctedPath = ps.path.replace(/\[\]/g, '');
  const isArrayPath = ps.path.endsWith('[]');
  // 1. パスが配列そのもの（例: tags[]）の場合 -> any/all を提案
  if (isArrayPath) {
    const base = correctedPath;
    let key = 'value'; // デフォルトのキー（要素がプリミティブの場合）
    let value = '"some_value"'; // デフォルトの値

    // --- 修正ポイント ---
    // サンプルデータから、より具体的なキーと値を抽出する
    const firstSample = ps.samples[0];
    if (isPlainObject(firstSample)) {
        // オブジェクトの場合、最初のキーを代表キーとして使用
        key = Object.keys(firstSample)[0] ?? 'key';
        
        // そのキーに対応する値を取得し、型に応じてクォートで囲む
        const sampleValue = (firstSample as Record<string, unknown>)[key];
        if (typeof sampleValue === 'string') {
            value = `"${String(sampleValue).replace(/"/g, '\\"')}"`;
        } else if (typeof sampleValue === 'number' || typeof sampleValue === 'boolean') {
            value = String(sampleValue);
        }
        // 他の型の場合はデフォルト値のまま
    } else if (typeof firstSample === 'string') {
        // 要素が文字列のプリミティブ配列の場合
        value = `"${String(firstSample).replace(/"/g, '\\"')}"`;
    }
    
    // 生成したキーと値で述語を作成
    const predicateExample = `${key} = ${value}`;

    out.push({
      label: `any(${base}, ...)`,
      query: `any(${base}, ${predicateExample})`,
      rationale: '配列に条件に合う要素が1つでも存在するか。',
    });
    out.push({
      label: `all(${base}, ...)`,
      query: `all(${base}, ${predicateExample})`,
      rationale: '配列の全要素が条件に合うか。',
    });
    
    return out;
  }
  // 2. それ以外のパス（通常のスカラー or 配列内のスカラー）
  if (has('string')) {
    const sample = String(ps.samples.find(x => typeof x === 'string') ?? 'text')
      .replace(/"/g, '\\"');
    
    // ★ 修正点: :contains("...") ではなく、省略形の `:"..."` を使用する
    out.push({
      label: `${correctedPath}:"..."`, // ラベルも省略形に合わせる
      // クエリ生成時に : を挟んで値をダブルクォートで囲む
      query: `${correctedPath}:"${sample.split(/\s+/)[0] || sample}"`,
      rationale: 'テキスト検索（部分一致）',
    });
  }
  if (has('number')) {
    const numSample = Number(ps.samples.find(x => typeof x === 'number'));
    if (Number.isFinite(numSample)) {
      out.push({
        label: `${correctedPath} >=`,
        query: `${correctedPath} >= ${Math.floor(numSample)}`,
        rationale: '数値比較',
      });
    }
  }
  if (has('boolean')) {
    out.push({
      label: `${correctedPath} = true`,
      query: `${correctedPath} = true`,
      rationale: '真偽値での絞り込み',
    });
  }

  return out;
}

// schema-suggest.ts

// ... (suggestionsForPath, isPlainObject などの既存ヘルパー関数はそのまま)

// 全体の推奨セットを構築する関数を修正
export function buildSuggestions(schema: SchemaSummary, limit = 12): Suggestion[] {
  const candidates = schema.flat
    .filter(ps => ps.path !== '$' && !ps.path.endsWith('[]')) // 配列そのものは除外
    .map(ps => ({ ps, score: calculateScore(ps) })) // スコア付け
    .sort((a, b) => b.score - a.score);

  const out: Suggestion[] = [];

  // --- 1. 個別フィールドの提案 ---
  for (const { ps } of candidates) {
    out.push(...suggestionsForPath(ps));
    if (out.length >= limit) break;
  }

  // --- 2. 組み合わせパターンの提案 (NOT, OR, AND) ---
  const stringField = candidates.find(c => dominantKind(c.ps) === 'string');
  const numberField = candidates.find(c => dominantKind(c.ps) === 'number');

  // NOT の提案 (数値フィールドが存在する場合)
  if (numberField) {
    const path = numberField.ps.path.replace(/\[\]/g, '');
    const numSample = Number(numberField.ps.samples.find(v => typeof v === 'number')) || 10;
    out.push({
      label: `NOT (...)`,
      query: `NOT (${path} > ${numSample})`,
      rationale: '条件を否定するNOT演算子の使用例。',
    });
  }
  
  // OR の提案 (代表的な文字列フィールドが2つ以上ある場合など)
  // ここでは簡略化し、文字列と数値フィールドがあればORでつなぐ
  if (stringField && numberField) {
    const strPath = stringField.ps.path.replace(/\[\]/g, '');
    const strSample = String(stringField.ps.samples.find(v => typeof v === 'string') ?? 'example').replace(/"/g, '\\"');
    const numPath = numberField.ps.path.replace(/\[\]/g, '');
    const numSample = Number(numberField.ps.samples.find(v => typeof v === 'number')) || 15;
    
    out.push({
      label: `... OR ...`,
      query: `${strPath}:"${strSample}" OR ${numPath} < ${numSample}`,
      rationale: '複数の条件のいずれかを満たすOR演算子の使用例。',
    });
  }

  // AND はデフォルトでユーザーが連結することを期待できるため、優先度は低め
  // 必要であればORと同様のロジックで追加可能

  // 重複を除去し、上限数に切り詰める
  const uniqueQueries = new Map<string, Suggestion>();
  for (const s of out) {
    if (!uniqueQueries.has(s.query)) {
      uniqueQueries.set(s.query, s);
    }
  }

  return Array.from(uniqueQueries.values()).slice(0, limit);
}

// パスの優勢型を判定するヘルパー関数
function dominantKind(ps: PathStat): string {
    const entries = Object.entries(ps.types);
    if (!entries.length) return 'unknown';
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0][0];
}

// パスの有用度をスコアリングするヘルパー関数
function calculateScore(ps: PathStat): number {
    const c = ps.types;
    return (c.string ?? 0) * 3 + (c.number ?? 0) * 2 + (c.boolean ?? 0) * 2;
}

