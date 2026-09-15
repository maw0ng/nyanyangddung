# 냐냐냥뜡 릴리스 가이드

이 문서는 "냐냐냥뜡" Windows 데스크톱 앱을 빌드하고, GitHub Releases로 배포하고,
설치된 사용자에게 자동 업데이트가 전달되기까지의 전체 과정을 설명한다.

## 1. 앱 정보 (변경 금지 항목 포함)

| 항목 | 값 |
|---|---|
| 사용자 표시 이름 (productName) | 냐냐냥뜡 |
| 영문 내부 이름 | Nyanyangddung |
| appId | `com.nyanyangddung.app` |
| 초기 버전 | 1.0.0 |

**`appId`(`com.nyanyangddung.app`)는 출시 이후 절대 변경하지 않는다.**
Windows에서 `appId`는 설치된 앱의 `userData` 폴더 경로, 자동 업데이트 식별자,
그리고 "이전 버전과 같은 앱인지"를 판단하는 사실상의 영구 식별자다. 이 값을
바꾸면 기존 사용자의 로컬 데이터(CharacterPreset, Timer, EXP 등)가 새 설치와
연결되지 않아 전부 새로 시작된 것처럼 보이게 된다.

`productName`(냐냐냥뜡)도 특별한 마이그레이션 계획 없이 바꾸지 않는다 -
설치 경로(`%LOCALAPPDATA%\Programs\냐냐냥뜡`)와 시작 메뉴/바탕화면 바로가기
이름이 여기서 파생된다.

## 2. 버전 정책

- `package.json`의 `version` 필드가 유일한 버전 source of truth다.
- Git 태그는 항상 `v` + `package.json` version과 정확히 같아야 한다.
  - 예: `package.json` version이 `1.0.1`이면 태그는 `v1.0.1`.
- 태그와 `package.json` version이 다르면 GitHub Actions workflow가
  **빌드 단계에서 즉시 실패**한다(의도된 동작 - 잘못된 버전이 배포되는 것을
  막기 위함).

## 3. 로컬에서 Windows 인스톨러 빌드하기

한 줄로 인스톨러만 만들고 싶을 때(GitHub에 업로드하지 않음):

```bash
npm run desktop:dist
```

결과물:
- `dist/Nyanyangddung-Setup-<version>.exe` (설치 프로그램)
- `dist/Nyanyangddung-Setup-<version>.exe.blockmap`
- `dist/latest.yml` (자동 업데이트 메타데이터 - 로컬 빌드에서는 실제로 쓰이지
  않지만 항상 함께 생성된다)

기존 `npm run desktop:build`도 동일하게 동작하며 그대로 유지된다. `desktop:dist`는
`--publish never`가 명시적으로 붙어 있어 실수로 GitHub에 업로드되는 일이 없다.

## 4. 아이콘

원본 아이콘: `build/icon.png` (투명 배경, 로우폴리 고양이 발바닥 - **이 디자인을
바꾸지 않는다**).

Windows용 multi-resolution `.ico`는 이 PNG에서 생성한다:

```bash
npm run icon:generate
```

`build/icon.png`를 다시 교체하는 경우에만 이 명령을 다시 실행해 `build/icon.ico`를
갱신한다. 평소 빌드(`desktop:build`/`desktop:dist`/`release:win`)에는 포함되어
있지 않다 - 아이콘 소스가 사실상 거의 바뀌지 않기 때문.

## 5. GitHub에 정식 Release 만들기 (태그 기반)

```bash
git tag v1.0.0
git push origin v1.0.0
```

이 태그 push가 `.github/workflows/release-windows.yml`을 트리거해서:
1. 의존성 설치
2. 타입체크 (`tsc --noEmit` x2)
3. Next.js 프로덕션 빌드 (sanity check) + Electron용 static export
4. Electron main/preload 컴파일
5. NSIS 인스톨러 빌드
6. GitHub Release 생성 + 인스톨러/`latest.yml`/`.blockmap` 업로드

를 자동으로 수행한다. **일반 commit/push로는 Release가 생성되지 않는다** -
`v*` 형태의 태그를 push했을 때만 동작한다.

## 6. 자동 업데이트 동작 방식

- 설치된 앱이 실행되면 몇 초 후 백그라운드에서 GitHub Releases를 확인한다
  (개발 모드에서는 절대 실행되지 않음 - `app.isPackaged`로 분기).
- 새 버전을 찾으면 자동으로 다운로드한다.
- 다운로드가 끝나면 캐릭터 근처에 작은 알림
  ("새 버전이 준비되었습니다 [지금 재시작] [나중에]")이 뜬다.
- **사용자가 직접 "지금 재시작"을 누르기 전까지는 절대 앱을 강제 재시작/
  종료하지 않는다** - Timer가 실행 중이어도 방해하지 않는다.
- 플로팅 메뉴 → 설정 안에도 "업데이트 확인" 수동 버튼이 있다.
- stable(안정) 채널만 지원한다 - GitHub prerelease는 자동 배포 대상에서
  제외된다.

## 7. 환경변수 (빌드에 필요)

| 이름 | 용도 | 어디에 설정 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL | 로컬: `.env.local` / CI: GitHub Secrets |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon(public) key | 로컬: `.env.local` / CI: GitHub Secrets |

**`SUPABASE_SERVICE_ROLE_KEY`는 어떤 경우에도 앱 번들/클라이언트 코드에
포함하지 않는다.** 이 프로젝트에는 애초에 이 키를 쓰는 코드가 없다.

## 8. Supabase migration이 포함된 릴리스 순서

클라이언트 업데이터는 Supabase DB를 절대 건드리지 않는다. DB 변경이 필요한
버전을 배포할 때는 반드시 다음 순서를 지킨다:

1. **먼저** backward-compatible한 Supabase migration을 SQL Editor에서 직접 실행
   (기존 사용자가 구버전 앱으로 계속 접속해도 깨지지 않는 형태로 작성)
2. `package.json`의 `version` 증가
3. 로컬 빌드/타입체크로 검증
4. `git tag vX.Y.Z && git push origin vX.Y.Z`
5. GitHub Release 자동 생성
6. 사용자 클라이언트가 순차적으로 자동 업데이트

**구버전과 신버전이 CoWork 같은 방에 잠시 공존할 수 있다는 것을 항상 가정한다**
- Supabase 스키마 변경은 가능한 한 additive(컬럼 추가 등)로 유지하고, 기존 컬럼을
  삭제/타입 변경하는 파괴적 migration은 피한다.

## 9. 코드 서명(Code Signing)

v1.0.0은 **서명되지 않은(unsigned) 빌드**다. Windows Code Signing 인증서를
나중에 구매하면 다음과 같이 추가할 수 있도록 구조만 준비되어 있다 (실제 인증서
파일/값은 절대 이 저장소에 넣지 않는다):

- GitHub Secrets에 `CSC_LINK`(인증서 base64 또는 URL)와 `CSC_KEY_PASSWORD`를
  등록하면 electron-builder가 자동으로 감지해서 서명한다 - 추가 코드 수정 불필요.
- `.github/workflows/release-windows.yml`에는 `CSC_IDENTITY_AUTO_DISCOVERY: "false"`가
  설정되어 있어, 인증서를 명시적으로 넣기 전까지는 절대 우연히 서명되지 않는다.

## 10. SmartScreen 경고

서명되지 않은 `Nyanyangddung-Setup-1.0.0.exe`를 실행하면 Windows SmartScreen이
"Windows에서 PC를 보호했습니다" 같은 경고를 띄울 수 있다. **이것은 앱의 버그가
아니다** - 새로 배포된 서명 없는 실행 파일에 Windows가 보이는 정상적인 반응이다.
"추가 정보" → "실행"으로 설치를 계속할 수 있다. 코드 서명 인증서를 추가하고
평판(reputation)이 쌓이면 자연히 사라진다.

## 11. 롤백 주의사항

- GitHub Release를 삭제해도 이미 설치된 사용자의 앱은 영향받지 않는다(로컬에
  이미 설치되어 있으므로).
- 하지만 `latest.yml`이 가리키는 Release를 삭제하면 **다음 업데이트 확인이
  실패**할 수 있다 - 새 정상 버전을 다시 태그/배포해서 덮어쓰는 방식으로
  해결한다.
- 이미 출시한 버전보다 낮은 버전 번호로 다시 배포하지 않는다(사용자가
  다운그레이드되는 일이 없도록).

## 12. 사용자 데이터 보존

앱 업데이트는 다음을 **절대 초기화하지 않는다**:
CharacterPreset, activeCharacterId, Hair/Face/Tops paint, Morph, Cosmetics(장착/
transform/paint), 로컬 profile, Timer 데이터, EXP, Desktop 설정.

이 데이터는 전부 `userData`(IndexedDB/localStorage) 안에 있고, `appId`가
고정되어 있는 한(§1) NSIS 업데이트 설치는 이 폴더를 건드리지 않는다. 앱
updater는 Supabase도, 로컬 IndexedDB도 직접 변환/삭제하지 않는다 - 스키마
migration은 항상 앱 코드 내부(characterPresetStorage.ts 등 기존 마이그레이션
레이어)에서만 처리한다.
