# Talent Sign Capture

タレントのサイン執筆データをブラウザで収集するための独立した静的ウェブツールです。

既存の sender / receiver / server とは分けるため、`talent-sign-capture/` 配下だけで完結しています。

## 使い方

`index.html` をブラウザで開きます。

```bash
open talent-sign-capture/index.html
```

ブラウザ上でサインを書き、タレント名を入力して「保存」を押すと、そのブラウザの `localStorage` に保存されます。

「やり直し」を押すと、現在のサイン入力が削除されます。編集中の保存済みレコードがある場合は、その保存データも同時に削除します。

タレント名とキャンバスの間には、保存済み一覧が常に表示されます。一覧の項目を押すと、そのサインが書き順と速度に沿って再生されます。「再生」を押すと、現在選択中のサインをもう一度再生できます。

## Electron再生ツール

Supabaseに保存された `payload` をローカルで再生確認するElectronツールです。

```bash
npm install
npm run replay
```

Electronを起動すると、Supabaseの `sign_records` から最新200件を自動取得し、「どのサインを書く？」の選択画面を表示します。サインを選ぶと、ボタンやテキストのない白いキャンバスへ切り替わり、縦向きL判比率の色紙に書き順どおり再生します。ローカルだけで安全に読むため、`talent-sign-capture/.env.local` に以下を保存します。

```bash
SUPABASE_SERVICE_ROLE_KEY=Supabaseのservice_roleキー
```

このファイルはgit管理外です。Supabase側では `service_role` に読み取り権限を付けます。

```sql
grant usage on schema public to service_role;
grant select on public.sign_records to service_role;
```

再生完了後は、初期設定で1.5秒後にキャンバスが白紙になります。

## 保存データ

保存データの座標はキャンバスサイズに依存しない `0..1` の正規化座標です。印刷側では任意の印字領域サイズへスケールして利用できます。

各ストロークにはペン色の `color` を保存します。各ポイントには書き順再現に必要な `elapsedMs`、`strokeElapsedMs`、`deltaMs` と、速度の `speedPxPerSecond` / `speedNormalizedPerSecond` を保存します。対応端末では `pressure`、`tiltX`、`tiltY`、`twist`、接触サイズも保存します。

ブラウザ上では以下のAPIで保存済みサインを呼び出し、書き順と速度に沿って再現できます。

```js
window.TalentSignCapture.loadLatest();
window.TalentSignCapture.loadRecord("<record-id>");
window.TalentSignCapture.replayCurrent();
```

## データ概要

```json
{
  "version": 2,
  "id": "...",
  "talentName": "山田 花子",
  "capture": {
    "durationMs": 1240,
    "pointCount": 120,
    "timing": "elapsedMs",
    "order": "array-index"
  },
  "canvas": {
    "coordinateSpace": "normalized"
  },
  "strokes": [
    {
      "tool": "pen",
      "size": 6,
      "color": "#111111",
      "pointerType": "pen",
      "order": 0,
      "durationMs": 1240,
      "points": [
        {
          "x": 0.12,
          "y": 0.34,
          "pressure": 0.5,
          "elapsedMs": 42,
          "strokeElapsedMs": 42,
          "deltaMs": 16,
          "speedPxPerSecond": 820.4,
          "speedNormalizedPerSecond": 1.42,
          "tiltX": 10,
          "tiltY": -5
        }
      ]
    }
  ]
}
```
