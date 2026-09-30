# Virgil for Visual Studio Code

Language support for the [Virgil](https://github.com/titzer/virgil) programming language:

* Syntax highlighting for `.v3` files (TextMate grammar in `syntaxes/`).
* Semantic highlighting of declarations, types, methods, parameters and variables, driven by
  a tree-sitter grammar (`grammar/grammar.js`) compiled to WebAssembly.
* Debugging in the compiler's built-in interpreter debugger (`v3c -debug`) through the
  Debug Adapter Protocol: breakpoints, stepping, stack traces, and local variables.

## Install

Search for **Virgil** in the Extensions view, or download a `.vsix` from the
[releases page](https://github.com/titzer/virgil-vscode/releases) and run
`code --install-extension virgil-<version>.vsix`.

## Debugging

Open a `.v3` file, pick **Debug current Virgil file** from the Run and Debug view, or add a
launch configuration:

```json
{
    "type": "virgil",
    "request": "launch",
    "name": "Debug current Virgil file",
    "debugger": "v3c",
    "program": ["${file}"],
    "stopOnEntry": true
}
```

`debugger` is the path to a `v3c` (or `Aeneas`) binary; `program` lists the source files of the
program. The debugger needs a compiler built from the Virgil repository (it uses `-debug -debug-extension`).

## Building

Requires Node.js 20+. `make build` (or `npm install && npm run build`) bundles the extension into
`dist/`; `make package` produces a `.vsix`; `make install` installs it into your local VS Code.

To hack on the extension, open this folder in VS Code and press F5 (Run Extension). A build is
needed first.

### Grammar

`grammar/grammar.js` is the tree-sitter grammar and `grammar/tree-sitter-virgil.wasm` is the
compiled parser that ships in the extension. After editing the grammar, rebuild the wasm with
`make grammar` (`tree-sitter generate` + `tree-sitter build --wasm`, which needs either
[emscripten](https://emscripten.org) or a running Docker daemon) and commit the new `.wasm`.

Known gaps: `layout` and `packing` declarations are not parsed; tree-sitter recovers and the rest
of the file is still highlighted.

## Releasing

See [RELEASING.md](RELEASING.md).
