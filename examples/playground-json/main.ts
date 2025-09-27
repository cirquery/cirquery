// examples/playground-json/main.ts
import { parse, normalize, buildPredicate } from 'cirquery';
import { inferSchemaDetailed, buildSuggestions } from './schema-suggest'; // 後で作成



// --- 状態管理 ---
const state = {
  rows: [] as Record<string, unknown>[],
  error: null as string | null,
};

// --- DOM要素の参照 ---
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const queryInput = $<HTMLInputElement>('queryInput');
const jsonInput = $<HTMLTextAreaElement>('jsonInput');
const cirOutput = $<HTMLPreElement>('cirOutput');
const suggestions = $<HTMLDivElement>('suggestions');
const errorElem = $<HTMLDivElement>('error');
const statsElem = $<HTMLSpanElement>('stats');
const results = $<HTMLDivElement>('results');
const runBtn = $<HTMLButtonElement>('runBtn');
const loadSampleBtn = $<HTMLButtonElement>('loadSampleBtn');
const dropzone = $<HTMLDivElement>('dropzone');


// --- イベントハンドラ ---

function handleRun() {
    state.error = null;
    const query = queryInput.value;
    try {
      // 1. DSLをパースしてCIRに正規化
      const { ast } = parse(query);
      const cir = normalize(ast);
      $('cirOutput').textContent = JSON.stringify(cir, null, 2);
  
      // 2. CIRから述語関数を一度だけ生成する
      //    オプションで ignoreCase や foldDiacritics も指定可能
      const predicate = buildPredicate(cir as any, { 
        ignoreCase: true, // 例: 大文字・小文字を区別しない
        foldDiacritics: true // 例: アクセント記号を無視する
      });
  
      // 3. 生成した述語関数を使ってデータをフィルタリング
      const results = state.rows.filter(predicate);
  
      // 4. 結果を描画
      renderTable(results);
  
      // URLハッシュにクエリを保存
      location.hash = encodeURIComponent(query);
    } catch (e: any) {
      state.error = e.message;
      console.error("実行エラー:", e);
    }
    renderError();
  }
  

function handleJsonInput() {
  try {
    const rawJson = jsonInput.value;
    if (!rawJson.trim()) {
      state.rows = [];
    } else {
      const parsed = JSON.parse(rawJson);
      if (!Array.isArray(parsed)) throw new Error("データはJSON配列形式である必要があります。");
      state.rows = parsed;
    }
    state.error = null;
  } catch (e: any) {
    state.error = e.message;
  }
  renderAll();
}

function handleFileDrop(e: DragEvent) {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    jsonInput.value = String(reader.result ?? '');
    handleJsonInput();
  };
  reader.onerror = () => { state.error = "ファイル読み込みに失敗しました。"; renderError(); };
  reader.readAsText(file);
}

// --- レンダリング関数 ---
function renderAll() {
  renderSuggestions();
  renderError();
  $('stats').textContent = `読み込み件数: ${state.rows.length}`;
}

function renderError() { $('error').textContent = state.error ?? ''; }

function renderTable(rows: Record<string, unknown>[]) {
    const container = document.getElementById('results') as HTMLDivElement;
    
    // 以前の内容をクリア
    container.innerHTML = '';
  
    // 結果が空の場合のメッセージ
    if (!rows.length) {
      container.textContent = '結果がありません。';
      return;
    }
  
    // 全オブジェクトからユニークなキーをすべて抽出し、ヘッダーとして使用
    const headers = [...new Set(rows.flatMap(r => Object.keys(r)))];
  
    const table = document.createElement('table');
  
    // --- テーブルヘッダー (<thead>) の作成 ---
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const headerText of headers) {
      const th = document.createElement('th');
      th.textContent = headerText;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
  
    // --- テーブルボディ (<tbody>) の作成 ---
    const tbody = document.createElement('tbody');
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const header of headers) {
        const td = document.createElement('td');
        const value = row[header];
  
        // 値の型に応じた表示処理
        if (value === null || value === undefined) {
          td.textContent = ''; // nullやundefinedは空文字として表示
        } else if (typeof value === 'object') {
          // オブジェクトや配列はJSON文字列に変換して表示
          td.textContent = JSON.stringify(value, null, 2);
        } else {
          td.textContent = String(value);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  
    // 完成したテーブルをコンテナに追加
    container.appendChild(table);
  }
  

function renderSuggestions() {
  const container = $('suggestions');
  container.innerHTML = '';
  const schema = inferSchemaDetailed(state.rows);
  const suggestions = buildSuggestions(schema);
  suggestions.forEach(s => {
    const btn = document.createElement('button');
    btn.textContent = s.label;
    btn.title = s.query;
    btn.onclick = () => { queryInput.value = s.query; handleRun(); };
    container.appendChild(btn);
  });
}

// サンプル JSON 読み込み
async function loadSampleData() {
  const res = await fetch('./cocktails.json');  // public/cocktails.json に配置
  const data = await res.json();
  jsonInput.value = JSON.stringify(data, null, 2);
  handleJsonInput();
}

// --- 初期化 ---
function init() {
  // イベントリスナー設定
  $('runBtn').addEventListener('click', handleRun);
  $('loadSampleBtn').addEventListener('click', loadSampleData);
  jsonInput.addEventListener('input', handleJsonInput);
  const dropzone = $('dropzone');
  dropzone.addEventListener('dragover', e => e.preventDefault());
  dropzone.addEventListener('drop', handleFileDrop);

  // URLハッシュからクエリを復元
  if (location.hash) {
    queryInput.value = decodeURIComponent(location.hash.slice(1));
  }

  // 初期表示
  loadSampleData();
}

document.addEventListener('DOMContentLoaded', init);
