# Releasing

The extension is published to the VS Code Marketplace under the publisher `titzer`
(`package.json` → `publisher`).

## One-time setup

1. Create the publisher at https://marketplace.visualstudio.com/manage (sign in with a Microsoft
   account; the publisher ID must match `package.json`).
2. Create a Personal Access Token at https://dev.azure.com → User settings → Personal access
   tokens, organization **All accessible organizations**, scope **Marketplace → Manage**.
3. For CI publishing, add the token as the repository secret `VSCE_PAT`
   (Settings → Secrets and variables → Actions).

## Cutting a release

1. Bump `version` in `package.json` and add a section to `CHANGELOG.md`.
2. Commit, tag, and push:

   ```
   git commit -am "Release 0.1.0"
   git tag v0.1.0
   git push origin main v0.1.0
   ```

   The `release` job in `.github/workflows/ci.yml` builds the `.vsix`, attaches it to a GitHub
   release, and publishes it to the Marketplace.

To publish by hand instead:

```
npm install
npx vsce publish -p <token>       # or: npx vsce package && npx vsce publish -i virgil-0.1.0.vsix
```

## Retiring the old student extensions

The Marketplace listing `ahuoguo.virgil` predates this repository. Once this extension is
published, ask its owner to unpublish it (or mark it deprecated pointing at `titzer.virgil`) from
their https://marketplace.visualstudio.com/manage page, since only the publisher can do that.
