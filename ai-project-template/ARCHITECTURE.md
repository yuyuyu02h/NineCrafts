# 構成

## 現在の実装

- src/main.tsx: SPAエントリ。SSR・Routerなし。
- src/App.tsx: HUD・設定・入力・ゲームループ・プレイヤー物理・各機能の接続。
- src/items.ts / useItems.ts: 所持品・カーソル・材料・かまどの原子的な操作と最新参照。更新は同期的に一度だけ実行し、React表示はその写し。
- src/ItemMenu.tsx: インベントリ・作業台・精錬・チェストの表示。半分取得／1個配置／Shift移動の操作をitems.tsへ接続。
- src/SurvivalHud.tsx: ピクセルの体力・空腹・酸素、9枠ホットバー、手持ち表示。
- src/Dialog.tsx: 所持品・設定・ヘルプの共通フォーカス、Tab循環とEscape。死亡・エラー画面への共通化は未完了。
- src/playerMotion.ts: 歩行速度、細分化した衝突・接触補正、スニーク時の縁の保護。
- src/environmentSettings.ts: 描画距離別の霧と雲の初期行列。src/lifecycle.ts: 初期化途中を含む資源解放。
- src/TouchControls.tsx: ポインターID別の移動・視点・長押し。src/mining.ts: 適正道具・必要ランク・所要秒。
- src/furnace.ts: 入力・燃料・出力・経過秒の純粋な精錬処理。
- src/world.ts: チャンク生成・ブロック・InstancedMesh・水・爆発。
- src/mobs.ts: モブAI・戦闘・矢・ドロップ。
- src/blocks.ts / recipes.ts / types.ts: 定義と型、レシピ照合。
- src/environment.ts / textures.ts / audio.ts: 環境演出・画像生成・音声。

## データフロー

入力 → Three.js/ref内のゲーム状態更新 → 必要なHUDをReactへ通知 → 描画。
GameSessionとitemsRefをゲーム状態の正とし、物理・設備・戦闘は共通の60Hz固定ステップで更新する。React stateは表示用の写しで、HUDへ10Hzで通知する。残るAppの分割・毎更新の割り当ては、実測と変更範囲に応じて整理する。

## P01で追加した保存経路

ゲーム状態のスナップショット → バージョン・範囲検証 → IndexedDBトランザクション → 保存完了表示。
起動時は保存を検査して続きから再開する。破損・非対応版・ストレージ拒否の場合は既存データを上書きせず理由を表示する。
ワールドはシード＋編集差分（撤去も記録）で保存し、未生成領域は同じシードから再現する。
保存対象: ワールド、視点と位置、HP/空腹、所持品、カーソル、クラフト材料、設備、実績、昼夜、設定。
かまどはブロック座標ごとに保存。チェストも座標別27枠で保存。旧共通データは最初に開いた設備へ一度だけ移行。

## 制約・負債

- クラウド保存・API・アカウントは導入しない。保存は同一ブラウザ・同一オリジン内。
- R01〜R28/L01の未対応範囲はTODO.md参照。
- 型チェック成功を実機表示・FPS成功と同一視しない。

## 保存の実装

- src/save.ts: GameSave/WorldSave、version=3、データの形・ID・個数・耐久・有限座標の検証。上限は編集500,000セル、ドロップ10,000個、かまど10,000台・チェスト10,000個・起爆待ちTNT128個。v2のチェスト共通状態も互換移行する。v1の共通かまどはlegacyFurnaceへ移行し、最初の設備を開いたとき一度だけ割り当てる。
- src/storage.ts: DB名ninecrafts / worldsストア / activeキー。currentとpreviousを同じreadwriteトランザクションで保持する。savedAtを比較し古いタブからの上書きを拒否する。
- src/worldSeed.ts: シード・座標から鉱石／植生を再現。樹木は自チャンクのセルだけを生成し、訪問順の影響をなくす。
- VoxelWorld.blockEdits: 設置／撤去／流水／爆発による変更を保持。地形生成自体は差分へ記録しない。
- App: 保存用refで最新UIを参照。初期復元が終わるまで開始ボタンとシミュレーションを止める。履歴にあるブロック全件import方式は使用しない。
- tests/save.test.ts、tests/world-save.test.ts: 形式、異常データ、ストレージ利用不可、シード再現、負座標・撤去・設置の回帰検証。

## P02〜P05の状態と時計

- itemsRefを取得／消費／制作／保存の共通の正とする。insertStackはaccepted/remainingを返し、残りを地面・出力・カーソルへ保持する。制作は受取可否を確認してから確定する。
- playingRefはPointer Lockと独立し、タッチ操作も同じゲームループに接続する。blur・非表示・ポーズで移動と採掘を解除する。
- rAFのdeltaは最大0.08秒。P06以降は60Hz固定ステップで物理・戦闘・設備・水・TNTを更新。採掘は秒で積算し、対象・装備変更でリセット。道具・ブロックの既存定義を使い、耐久0で破損する。
- かまどは固定ステップで更新し、表示通知は10Hz。P07により全メニュー・開始待機・死亡・非表示で、精錬を含む全シミュレーションを停止。燃料は実作業秒だけ減る。
- world.onBlockRemovedで設備の中身をドロップに戻す。爆発を含めて座標別状態を除去する。
- tests/items.test.ts / pickup.test.ts / touch.test.tsで数量保存、取得拒否、精錬、道具、アナログ入力を検証。開発専用HTMLでUIと複数ポインターを検証する（通常ビルド対象外）。

前世代バックアップは保存するが、復旧UIは未実装。破損・非対応データは削除せず保存を止める。モブ／矢は保存対象外。起爆待ちTNTの座標と残り秒はv3で保存。

## PCマウス入力の修正

src/mouseInput.tsはcanvasのmousedownとwindowのmouseup／pointercancel／blurを接続する。PointerLockControlsとrequestPointerLockも同じcanvasを対象にする。bodyへ固定してcanvas限定の入力を待つ構成は使用しない。UI・ポーズ中のクリックはゲーム動作へ流さない。タッチ側は個別PointerEventのまま。

## P06〜P09（実装・公開済み）

- src/simulation.ts: FixedStepper（60Hz、停止中の時間を蓄積しない）とGameSession（playing／paused／dead、HP・空腹・酸素・攻撃／被弾間隔）。Reactは表示用の写し。HUD通知は10Hz。
- Appで全メニュー・blur・visibilitychange・ロック解除・死亡に入力解除を適用。現行ではポーズ中の速度・落下距離は保持し、復活時に初期化する。死亡時の実時間タイマーは廃止。復活ボタンからfindSafeSpawn→resetPlayerViewで乾いた足場・視点水平・速度0・酸素10へ戻す。
- src/combat.ts: 身体のBox3と水平距離＋高さの近接判定。モブ・プレイヤー・矢で体積を使い、矢は移動線分に沿って壁と最初の対象を調べる。敵と動物は各12枠、夜は2秒・動物は5秒ごとに候補を探す。モブは48ブロック超で休止、80超で退去。
- ItemState.chests[座標]が27枠を持つ。クリック・回収とも原子的に数量を移す。かまどとチェストは撤去通知で中身をドロップし、アンロード時は中身を維持。
- 保存v3: chests／legacyChest、primedTnt、world.waterLevelsを追加。v1／v2を保護して移行。流れの横距離を保存し、再読み込みで全水セルが水源になることを防ぐ。
- VoxelWorldは描画距離＋1リングだけ生成データを常駐させる。外側のworldData／chunkData／render cache／光源を解放し、帰還時はシード＋チャンク別編集索引から再生成。編集履歴と設備内容は保持する。
- 水: 自然生成水は休止。キューは座標重複排除・2,048件、0.35秒に16セル、横距離3、流れ追加はwaterLevels計4,096セルを目安に停止。配置した水源と編集履歴は消去しない。
- 爆発は編集を一括反映し、描画行列を1回更新。GPUへは使用中の行列範囲だけ送る。トーチ光源は24ブロック内で近い8個、破片180個、矢128本を上限にする。
- src/resources.ts: 共有geometry／materialを重複なくdispose。個体削除では共通アトラスを壊さず、ページ終了時はworld／mobs／環境／テクスチャも解放する。

## 2026-10-22の追加実装

- キーボードのダッシュはRトグル。Ctrlは使用しない。リピート・修飾キー付きRでは変更しない。タッチのダッシュは長押し方式を維持する。
- GameSession.survivalで移動・時間による空腹、自然回復と空腹ダメージを進行中だけ更新。R切替はmoveStateに保持し、ポーズ時の入力解除でOFFになる。
- movePlayerは最大移動量0.25セルで細分化し、接触・縁を二分探索して移動を補正する。視点の上下に影響されないyaw基準の移動を使い、移動ベクトルの毎回生成を減らした。
- VoxelWorld.isChunkLoadedをドロップ更新前に確認し、未読込中の位置・速度・寿命を保つ。未生成領域を空気扱いして落下させない。
- 起動は段階別のCleanupScopeで後始末を登録。失敗時は画面へ理由と再試行を表示。context lost通知後はメモリ内スナップショットを新Canvas・新シーンへ復元する。これは永続バックアップ復旧UIとは別物。
- 通常時の霧はviewFog(renderDistance)。水中は水中用の霧。雲は全行列を初期アップロードし、アニメーションはレイヤー単位で移動する。
- BGMのmusicEnabled setterがタイマー・音源の停止と再予約を管理する。
- Appのstorage依存を差し替え可能にし、本体のIndexedDBと分離した検証DB／メモリ内プレビューを使用する。通常buildの入口は引き続きindex.htmlのみで、検証HTMLは公開buildへ含めない。

保存形式はv3のまま。新規依存・バックエンド追加なし。実装と検証対象コミットの区別はdocs/VALIDATION-LATEST.mdを参照。
