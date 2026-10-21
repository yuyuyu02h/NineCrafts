# 構成

## 現在の実装

- src/main.tsx: SPAエントリ。SSR・Routerなし。
- src/App.tsx: HUD・設定・入力・ゲームループ・プレイヤー物理・各機能の接続。
- src/items.ts / useItems.ts: 所持品・カーソル・材料・かまどの原子的な操作と最新参照。更新は同期的に一度だけ実行し、React表示はその写し。
- src/ItemMenu.tsx: インベントリ・作業台・精錬の表示、フォーカス制御。
- src/TouchControls.tsx: ポインターID別の移動・視点・長押し。src/mining.ts: 適正道具・必要ランク・所要秒。
- src/furnace.ts: 入力・燃料・出力・経過秒の純粋な精錬処理。
- src/world.ts: チャンク生成・ブロック・InstancedMesh・水・爆発。
- src/mobs.ts: モブAI・戦闘・矢・ドロップ。
- src/blocks.ts / recipes.ts / types.ts: 定義と型、レシピ照合。
- src/environment.ts / textures.ts / audio.ts: 環境演出・画像生成・音声。

## データフロー

入力 → Three.js/ref内のゲーム状態更新 → 必要なHUDをReactへ通知 → 描画。
現在はReact stateとrefの混在、古いクロージャ、別時計がある。各段階で必要な箇所から整理する。

## P01で追加した保存経路

ゲーム状態のスナップショット → バージョン・範囲検証 → IndexedDBトランザクション → 保存完了表示。
起動時は保存を検査して続きから再開する。破損・非対応版・ストレージ拒否の場合は既存データを上書きせず理由を表示する。
ワールドはシード＋編集差分（撤去も記録）で保存し、未生成領域は同じシードから再現する。
保存対象: ワールド、視点と位置、HP/空腹、所持品、カーソル、クラフト材料、設備、実績、昼夜、設定。
かまどはブロック座標ごとに保存。チェストは旧共通データを保護するが出し入れUIはP08の未実装項目。

## 制約・負債

- クラウド保存・API・アカウントは導入しない。保存は同一ブラウザ・同一オリジン内。
- R01〜R28/L01の未対応範囲はTODO.md参照。
- 型チェック成功を実機表示・FPS成功と同一視しない。

## 保存の実装

- src/save.ts: GameSave/WorldSave、version=2、データの形・ID・個数・耐久・有限座標の検証。上限は編集500,000セル、ドロップ10,000個、かまど10,000台。v1の共通かまどはlegacyFurnaceへ移行し、最初の設備を開いたとき一度だけ割り当てる。
- src/storage.ts: DB名ninecrafts / worldsストア / activeキー。currentとpreviousを同じreadwriteトランザクションで保持する。savedAtを比較し古いタブからの上書きを拒否する。
- src/worldSeed.ts: シード・座標から鉱石／植生を再現。樹木は自チャンクのセルだけを生成し、訪問順の影響をなくす。
- VoxelWorld.blockEdits: 設置／撤去／流水／爆発による変更を保持。地形生成自体は差分へ記録しない。
- App: 保存用refで最新UIを参照。初期復元が終わるまで開始ボタンとシミュレーションを止める。履歴にあるブロック全件import方式は使用しない。
- tests/save.test.ts、tests/world-save.test.ts: 形式、異常データ、ストレージ利用不可、シード再現、負座標・撤去・設置の回帰検証。

## P02〜P05の状態と時計

- itemsRefを取得／消費／制作／保存の共通の正とする。insertStackはaccepted/remainingを返し、残りを地面・出力・カーソルへ保持する。制作は受取可否を確認してから確定する。
- playingRefはPointer Lockと独立し、タッチ操作も同じゲームループに接続する。blur・非表示・ポーズで移動と採掘を解除する。
- rAFのdeltaは最大0.08秒。採掘は秒で積算し、対象・装備変更でリセット。道具・ブロックの既存定義を使い、耐久0で破損する。
- かまどはrAFで更新し、表示通知は10Hz。所持品・設備メニュー中は精錬し、設定・ヘルプ・開始待機・非表示では止まる。燃料は実作業秒だけ減る。
- world.onBlockRemovedで設備の中身をドロップに戻す。爆発を含めて座標別状態を除去する。
- tests/items.test.ts / pickup.test.ts / touch.test.tsで数量保存、取得拒否、精錬、道具、アナログ入力を検証。開発専用HTMLでUIと複数ポインターを検証する（通常ビルド対象外）。

前世代バックアップは保存するが、復旧UIは未実装。破損・非対応データは削除せず保存を止める。モブ／矢／TNTタイマーは現在の保存対象外。

## PCマウス入力の修正

src/mouseInput.tsはcanvasのmousedownとwindowのmouseup／pointercancel／blurを接続する。PointerLockControlsとrequestPointerLockも同じcanvasを対象にする。bodyへ固定してcanvas限定の入力を待つ構成は使用しない。UI・ポーズ中のクリックはゲーム動作へ流さない。タッチ側は個別PointerEventのまま。
