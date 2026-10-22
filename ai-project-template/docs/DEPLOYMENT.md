# Cloudflare公開記録

更新日: 2026-10-21

## 対象

- GitHub: https://github.com/yuyuyu02h/NineCrafts
- ブランチ: main
- 対象コミット: 4a904d54750469a53bf870834aaaca62625fb4c0
- GitHub APIのmain先端とローカルHEADが一致し、作業開始時にローカル変更なし。
- ユーザーからCloudflareへの公開を明示的に依頼済み。公開の許可は得ている。

## 公開前検証

- npm test: 32件成功。
- npm run lint: 成功（tsc --noEmit）。
- npm run build -- --outDir /private/tmp/ninecrafts-cloudflare-4a904d5: 成功。
- 成果物: index.html、assets/index-BoOFbQwP.js（854.86kB、gzip232.32kB）、assets/index-DwccpRf9.css（39.79kB、gzip7.57kB）。
- 既存の500kB超チャンク警告は継続。__dirname警告は解消済み。
- React/Viteの静的SPA。サーバーAPI・秘密鍵・環境変数の設定は不要。公開するのはビルド成果物だけ。

## 公開状態

公開済み。NineCrafts専用のCloudflare Pagesプロジェクトninecraftsを作成し、初回ビルド・本番デプロイが成功。
既存の公開先を確認し、あれば同じプロジェクトを更新。公開先がなければNineCrafts専用に作成する。無関係なsoloverse-apiへは反映しない。
公開URL・デプロイ・検証結果は下記参照。

## 次回更新時の確認

1. Cloudflareログイン後、Workers & PagesでNineCraftsの既存プロジェクトを確認。
2. Git連携のmainを優先し、ビルドコマンドnpm run build、出力distを設定。新規Workersの静的配信の場合はdistをassetsとして扱う。
3. 実際に使うビルド環境がVite8とimport.meta.dirnameに対応するNodeであることを確認（例: Node22.16以上）。
4. 対象コミットのデプロイ成功を確認し、公開URLで開始画面・読み込み・操作を検証。
5. URL、デプロイID、確認範囲、未確認範囲をこの文書へ追記。認証情報は記録しない。

## Cloudflare設定

- プロジェクト: ninecrafts（Cloudflare Pages）。既存4プロジェクトにNineCraftsがないことを確認して専用に新規作成。
- Git連携: yuyuyu02h/NineCrafts、Production branch main。既存GitHub連携で対象リポジトリが選択でき、新たな権限追加は不要だった。
- ビルド: npm run build。出力: dist。ルート: リポジトリ直下。
- ビルド変数: NODE_VERSION=22.16.0、BUN_VERSION=1.4.2（ローカルBunと同じ。コミット済みbun.lockを利用）。ランタイム秘密情報なし。
- 本番URL: https://ninecrafts.pages.dev/ （公開確認済み）。
- 管理画面: https://dash.cloudflare.com/5792e92574c4377975d373bfefd49cc2/pages/view/ninecrafts
- mainへのPushで自動ビルド・デプロイ。ソースコード・GitHubのコミットは変更しない。

## 公開結果 — 2026-10-21

- 本番URL: https://ninecrafts.pages.dev/
- 本番コミット: 4a904d54750469a53bf870834aaaca62625fb4c0（main、CloudflareのProduction表示で確認）。
- デプロイID: c1762f77-8e88-417a-a836-00f3dc28cc79
- 固定デプロイURL: https://c1762f77.ninecrafts.pages.dev/
- 詳細画面: https://dash.cloudflare.com/5792e92574c4377975d373bfefd49cc2/pages/view/ninecrafts/c1762f77-8e88-417a-a836-00f3dc28cc79
- CloudflareがSuccessと表示。ProductionでAutomatic deployments enabledを確認。
- 公開ページのscriptは/assets/index-BoOFbQwP.jsで、ローカルの対象コミットのビルド成果物と同じ名前。
- 公開URLをBraveで開き、開始画面・WebGLの地形／テクスチャ・タッチONでの開始・W移動・ドラッグ視点を確認。
- canvas領域を左クリック2.8秒長押しして原木16→17と採掘実績、下向きの地面へ右クリック設置で17→16を確認。
- 設定へ一時停止すると「保存しました」の表示を確認。確認時のブラウザエラーログは0件。タブは一時停止してユーザー用に残した。
- マウス入力はタッチONの代替プレイ状態で検証。Pointer Lock成功後の通常PC操作、スマホ実機の物理マルチタッチ・FPS・長時間性能は未確認。
- HTTPS公開URLを利用。セーブはブラウザ／オリジン単位のため、localhostのセーブは公開サイトへ自動移行しない。
- ソースコード・GitHubコミット・無関係なCloudflareアプリ・課金プラン・独自ドメインは変更していない。
- 証跡: evidence/cloudflare-deployment.png、evidence/cloudflare-live.png。

## 更新作業 — 2026-10-22

- ユーザーから「Push・公開」の明示許可。P06〜P09とBUG-001／002の修正を対象とする。
- 開始時のGitHub mainとローカルHEADは5a8cd37590ce257823ed4f51fa314857308b2081で一致。
- 公開前検証: テスト48件、型チェック、Vite build成功。JS index-BvbfNFwb.js（868.22kB、gzip236.70kB）。詳細はVALIDATION-P06-P09.md。
- mainへの通常Pushで既存Pagesの自動デプロイを実行し、完了後にコミット・デプロイID・公開表示を追記する。

## 公開結果 — 2026-10-22（P06〜P09）

- 本番URL: https://ninecrafts.pages.dev/
- 実装コミット: 2e8b798d7652ee390e2edbde301dd1732d145243（main）。通常Push成功。
- デプロイID: cc8814c7-e61e-4a2c-b1fd-c5fb1079add1
- 固定URL: https://cc8814c7.ninecrafts.pages.dev/
- CloudflareのProduction詳細でstatus success、所要22秒、ビルド・公開成功ログを確認。
- Node22.16.0／Bun1.4.2、凍結ロックファイルによる依存導入。JS index-BvbfNFwb.js／CSS index-BtLzwDa1.cssはローカル成果物と一致。500kB超の既存警告あり。
- 本番URLで開始画面と背後の地形表示を確認。DOMのscriptが最新版index-BvbfNFwb.jsであることを確認。確認時エラーログ0件。
- 公開上では既存セーブを更新しないため開始・採掘・設置・死亡再現は行わず、今回の操作検証はローカルの記録を参照する。実機FPS・物理タッチ・長時間検証は未実施。
- 公開作業時の再検証でもnpm test48件／npm run lint成功。
- 公開確認画像はローカルのみ保持。既存セーブ表示を含むため、画像Pushは自動承認審査により拒否され、GitHubへは送信していない。
- この公開結果の管理MDも追補コミットでmainへPushする。追補はゲームソース変更なし。
