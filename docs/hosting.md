# MarketStars ホスティング（静的サイト）

PRD「后续：任意代码上传及自动部署」のデモ版。対象は **静的サイト（HTML・CSS・JS・画像・フォント）** のみで、サーバー側でアップロードされたコードは実行しない。

## 流れ

1. アプリの接続方式を「MarketStars でホスティング」にする（起動 URL は不要）。
2. 開発者ポータル → アプリ → **ホスティング** で zip をアップロード → 検証（ビルド）。
   - 共通の最上位フォルダ（`dist/` など）は除去、`__MACOSX`・隠しファイルは無視
   - 許可した拡張子のみ（`.php` などは失敗）、パス検査（`..`・絶対パス・`\` 不可）、ルートに `index.html` 必須
   - 上限：zip 5MB・200 ファイル・1 ファイル 2MB・合計 20MB。展開は zlib の `maxOutputLength` で実サイズを制限（ヘッダーを偽った zip 爆弾対策）
   - 外部サイトの `<script src>` は配信時の CSP で読めないため警告
3. 成功したビルドは `/hosted/{slug}/~{buildId}/index.html` でプレビュー（提供会社のメンバーと運営のみ）。
4. 「本番に反映」で `App.hostedBuildId` を切り替え。「この版に戻す」でロールバック。「自動で反映」を選ぶとビルド成功時に即反映。すべて監査ログに残る。
   アプリ情報・料金の変更は従来どおり審査が必要。初回公開には本番ビルドが必要（`publishApp` で確認）。

## 配信と隔離

- 利用者は「アプリを開く」（`/launch/{subscriptionId}`）→ `/hosted/{slug}/index.html`。
- **HTML を返すたびに**、ログイン中の空間に有効な契約があるかを確認（無ければ 403、未ログインは 401）。提供会社・運営は常に閲覧可。CSS/JS/画像は公開（不透明オリジンからの読み込みには Cookie が付かないため）。
- すべての応答に `Content-Security-Policy: sandbox allow-scripts allow-forms …`（**allow-same-origin なし**）を付与。アップロードされたスクリプトは不透明オリジンで動き、MarketStars の Cookie・`localStorage`・認証付き API に触れられない（e2e Q1 で `document.cookie` が拒否されることを確認）。
- 本番運用では別ドメイン（例：`*.apps.marketstars.example`）からの配信と、ファイル本体の Cloud Storage 保存を推奨（デモはファイルを DB の `HostedFile` に保存）。

## デモ

- シード：「レジ締めチェック」（MarketStars Labs 提供・無料）がビルド #1 で公開済み。ひかり整骨院が利用中。
- サンプル zip：`/developer/hosting-sample?v=1.1.0`（版番号を変えて何度でもアップロードできる）。
- デモガイド `/demo` の「6b. MarketStars ホスティング」。
- テスト：`tests/unit/hosting.test.ts`、`tests/e2e-p15.mjs`。
