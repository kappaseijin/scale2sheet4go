# scale2sheet

朝・夜の身体測定値を Google Fit または Apple Health XML エクスポートから取得し、Google Spreadsheet の当日行へ転記する TypeScript サービスです。Node.js/TypeScript のみで動作し、OS 固有 API、ネイティブバインディング、LLM、外部推論サービスは使いません。

## 対応データ

Spreadsheet は既存行を更新します。1行目の `月日` 列で当日行を検索し、`朝*` または `夜*` 列へ値を書き込みます。

```text
月日 | 朝体重 | 朝体温 | 朝血圧上 | 朝血圧下 | 朝脈拍 | 夜体重 | 夜体温 | 夜血圧上 | 夜血圧下 | 夜脈拍
```

取得対象は体重、体温、収縮期血圧、拡張期血圧、脈拍です。Google Fit で体温データ型が利用できない場合、体温は空欄になります。

朝は `05:00` から `12:00`、夜は `20:00` から `23:30` の測定値だけを対象にします。対象時間帯の測定値がない場合、Spreadsheet は更新せず正常終了します。

## セットアップ

```sh
npm install
cp .env.example .env
```

`.env` を編集します。

```text
TIME_ZONE=Asia/Tokyo
GOOGLE_SHEET_ID=163Lc0YeN5ZnGeXdYqx6T_JGSMa91kpvfpoODjF7q8C0
GOOGLE_SHEET_NAME=体温・血圧
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
GOOGLE_FIT_CLIENT_ID=...
GOOGLE_FIT_CLIENT_SECRET=...
GOOGLE_FIT_REDIRECT_URI=http://localhost:3000/oauth2callback
GOOGLE_FIT_TOKEN_PATH=.scale2sheet/google-fit-token.json
GOOGLE_FIT_LOOKBACK_DAYS=14
APPLE_HEALTH_EXPORT_XML=/path/to/export.xml
MORNING_CRON=0 7 * * *
EVENING_CRON=0 21 * * *
```

Google Sheets は service account を使います。対象Spreadsheetをservice accountのメールアドレスに共有してください。

Google Fit は個人health dataのためinstalled app OAuthを使います。Google Cloud ConsoleでOAuth clientを作成し、redirect URIに `http://localhost:3000/oauth2callback` を登録してください。

## Google Fit 初回認証

```sh
npm run build
node dist/index.js auth
```

表示されたURLをブラウザで開いて認可します。認可後、CLIがlocalhost callbackを受け取り、`GOOGLE_FIT_TOKEN_PATH` にtoken JSONを保存します。

## Spreadsheet の前提

対象シートには当日行が事前に存在している必要があります。`月日` 列の日付は `YYYY-MM-DD`、`YYYY/MM/DD`、`M/D`、`M月D日` 形式に対応します。行が見つからない場合、自動作成はせずログを出して終了します。

## 手動実行

Google Fitから朝の列を更新します。

```sh
node dist/index.js run --period morning --source google-fit
```

Apple Health XMLから夜の列を更新します。

```sh
node dist/index.js run --period evening --source apple-health
```

## 常駐実行

既定ではGoogle Fitをsourceにして、`MORNING_CRON` と `EVENING_CRON` で実行します。

```sh
node dist/index.js serve
```

Apple Health XMLをsourceにする場合:

```sh
node dist/index.js serve --source apple-health
```

## 開発コマンド

```sh
npm run typecheck
npm test
npm run build
```
