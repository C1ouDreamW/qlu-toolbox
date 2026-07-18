# Android update manifest

`android.json` is generated only after a signed APK has been uploaded to the GitHub Release. Do not hand-edit hashes, sizes, package IDs, or version codes.

The release workflow pushes the generated manifest to a dedicated branch and adds a pull-request link to the workflow summary. Open that link and create the pull request so that the protected `main` branch runs its required status checks. Merge it after CI passes to make the new update visible to installed apps.

The migration build checks both stable locations independently:

- `https://raw.githubusercontent.com/C1ouDreamW/qlu-toolbox/main/updates/android.json`
- `https://raw.githubusercontent.com/C1ouDreamW/lumatile/main/updates/android.json`

Before the repository rename, the second URL may return 404. After the rename, the first URL may redirect or fail. One working, valid manifest is sufficient.
