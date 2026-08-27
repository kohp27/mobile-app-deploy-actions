# mobile-app-deploy-actions

モバイルアプリをストア(TestFlight / Google Play)へデプロイするためのGitHub Actions集。

## アクション

| アクション | 内容 |
| --- | --- |
| `derive-build-number` | 全対象アプリのストアを照会し、最大ビルド番号と+1した値を返す |
| `restore-android-keystore` | Secretsからkeystoreとkey.propertiesを復元する |
| `upload-ios` | xcodebuildでarchive(cloud signing)し、TestFlightにアップロードする |
| `upload-android` | ビルド済みAABをGoogle Playにアップロードする |

## 必要なシークレット

呼び出し側リポジトリのSecretsに以下を登録する(名前は推奨、アクションへは`with:`で渡す)。

### Android

サービスアカウントはGoogle Cloudで作成する。Play Consoleの「ユーザーと権限」で招待して対象アプリのリリース権限を付与する。

| 名前 | 内容 |
| --- | --- |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | GoogleサービスアカウントのJSON |
| `ANDROID_KEYSTORE_BASE64` | keystoreファイルのbase64 (`base64 -i release.jks`) |
| `ANDROID_KEYSTORE_PASSWORD` | keystoreのパスワード |
| `ANDROID_KEY_ALIAS` | keyのalias |
| `ANDROID_KEY_PASSWORD` | keyのパスワード |

### iOS

App Store Connectの「ユーザとアクセス > 統合」で作成する。cloud signingでの署名にはAdminロールのキーが必要。

| 名前 | 内容 |
| --- | --- |
| `APP_STORE_CONNECT_KEY_ID` | App Store Connect APIキーのKey ID |
| `APP_STORE_CONNECT_ISSUER_ID` | 同キーのIssuer ID |
| `APP_STORE_CONNECT_PRIVATE_KEY` | 同キーの秘密鍵(p8ファイル) |
