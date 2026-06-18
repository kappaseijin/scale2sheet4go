# scale2sheet

朝・夜の身体測定値を Google Fit または Apple Health XML エクスポートから取得し、Google Spreadsheet へ追記する TypeScript サービスです。Node.js/TypeScript のみで動作し、OS 固有 API、ネイティブバインディング、LLM、外部推論サービスは使いません。

## 対応データ

Spreadsheet には次の列順で追記します。

```text
日付 | 時刻 | 区分(朝/夜) | 体重 | 体温 | 血圧上 | 血圧下 | 脈拍 | ソース
```

取得対象は体重、体温、収縮期血圧、拡張期血圧、脈拍です。Google Fit で体温データ型が利用できない場合、体温は空欄になります。

## セットアップ

```sh
npm install
cp .env.example .env
```

`.env` を編集します。

```text
TIME_ZONE=Asia/Tokyo
GOOGLE_SHEET_ID=...
GOOGLE_SHEET_NAME=Measurements
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

## 手動実行

Google Fitから朝の行を追記します。

```sh
node dist/index.js run --period morning --source google-fit
```

Apple Health XMLから夜の行を追記します。

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
