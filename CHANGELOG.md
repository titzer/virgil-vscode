# Changelog

## 0.1.0

* Moved out of the Virgil compiler repository (`bin/dev/virgil-vscode`, `bin/dev/virgil-dbg-vscode`)
  into a repository of its own, and merged the highlighting and debugger extensions into one.
* Semantic highlighting now uses a WebAssembly build of the tree-sitter grammar instead of a
  native Node module, so one package works on every platform and VS Code version.
* Grammar: string and character escapes, `fun` expressions, `=>` method bodies, `...`/`..+`
  ranges, multi-index `a[i, j]`, `~`, binary and suffixed integer literals, `private` on
  top-level declarations, unnamed index methods, and `_` in patterns.

## 0.0.2 (ahuoguo.virgil)

* Initial student releases: TextMate + tree-sitter highlighting, and a separate debugger extension.
