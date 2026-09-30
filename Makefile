# Convenience targets; see README.md.
.PHONY: build package install grammar clean

build: node_modules
	npm run build

package: node_modules
	npm run package

install: node_modules
	npm run install-local

grammar: node_modules
	npm run grammar

node_modules: package.json
	npm install --no-audit --no-fund
	@touch node_modules

clean:
	rm -rf dist node_modules *.vsix grammar/src grammar/bindings grammar/build
