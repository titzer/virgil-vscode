// Copyright 2024 Virgil Authors. All rights reserved.
// See LICENSE for details of Apache 2.0 license.
//
// Semantic token provider backed by the tree-sitter grammar in grammar/, compiled to wasm.
import * as vscode from 'vscode';
import * as path from 'path';
import { Parser, Language, Node, Point } from 'web-tree-sitter';

export const tokenTypes = ['keyword', 'namespace', 'class', 'enum', 'enumMember', 'property', 'method', 'typeParameter', 'parameter', 'type', 'variable'] as const;
export type TokenType = typeof tokenTypes[number];
export const tokenModifiers = ['declaration', 'defaultLibrary'] as const;
export type TokenModifier = typeof tokenModifiers[number];

const BUILT_IN_TYPES = ['bool', 'string', 'int', 'long', 'byte', 'short', 'void', 'float', 'double', 'Array', 'Range', 'Ref', 'Pointer'];
const INT_TYPE = /^[iu]([1-9]|[1-5][0-9]|6[0-4])$/;

export const legend = new vscode.SemanticTokensLegend([...tokenTypes], [...tokenModifiers]);

export class SemanticHighlighter implements vscode.DocumentSemanticTokensProvider {
    private constructor(private parser: Parser) {}

    static async create(extensionPath: string): Promise<SemanticHighlighter> {
        const dist = path.join(extensionPath, 'dist');
        await Parser.init({ locateFile: (f: string) => path.join(dist, f) });
        const language = await Language.load(path.join(extensionPath, 'grammar', 'tree-sitter-virgil.wasm'));
        const parser = new Parser();
        parser.setLanguage(language);
        return new SemanticHighlighter(parser);
    }

    register(): vscode.Disposable {
        return vscode.languages.registerDocumentSemanticTokensProvider({ language: 'virgil' }, this, legend);
    }

    provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.SemanticTokens | null {
        const tree = this.parser.parse(document.getText());
        if (tree == null) return null;
        try {
            const builder = new vscode.SemanticTokensBuilder(legend);
            buildTokens(builder, tree.rootNode);
            return builder.build();
        } finally {
            tree.delete();
        }
    }
}

function toPosition(p: Point): vscode.Position {
    return new vscode.Position(p.row, p.column);
}

type Visitor = (node: Node) => void;

export function buildTokens(builder: vscode.SemanticTokensBuilder, root: Node) {
    const add = (node: Node | null, type: TokenType, modifiers?: TokenModifier[]) => {
        if (node == null) return;
        builder.push(new vscode.Range(toPosition(node.startPosition), toPosition(node.endPosition)), type, modifiers);
    };
    const field = (node: Node, name: string) => node.childForFieldName(name);
    const fields = (node: Node, name: string) => node.childrenForFieldName(name).filter((n): n is Node => n != null);

    const visitAll = (nodes: (Node | null)[]) => { for (const n of nodes) visit(n); };
    const visitNamedChildren = (node: Node | null) => { if (node) visitAll(node.namedChildren); };

    const visitParamDecl = (node: Node) => {
        add(field(node, 'name'), 'parameter');
        visit(field(node, 'type'));
    };

    // ident_param: name ('<' typeArgs '>')?
    const visitIdentParam = (node: Node, type: TokenType, modifiers?: TokenModifier[]) => {
        add(field(node, 'name'), type, modifiers);
        const typeArgs = field(node, 'typeArgs');
        if (typeArgs) {
            add(node.child(1), 'keyword');
            visitNamedChildren(typeArgs);
            add(node.child(3), 'keyword');
        }
    };

    const visitVarDecl = (node: Node, type: TokenType) => {
        add(field(node, 'name'), type);
        visitAll(fields(node, 'rest'));
    };

    const visitors: { [nodeType: string]: Visitor } = {
        var_param_decls: visitNamedChildren,
        param_decls: visitNamedChildren,
        new_param_decls: visitNamedChildren,

        var_param_decl: visitParamDecl,
        param_decl: visitParamDecl,
        new_param_decl: visitParamDecl,

        type_ref(node) {
            visitNamedChildren(field(node, 'tuple'));
            const members = fields(node, 'member');
            if (members.length == 1) {
                const t = members[0];
                const name = field(t, 'name')?.text ?? '';
                const builtIn = BUILT_IN_TYPES.includes(name) || INT_TYPE.test(name);
                visitIdentParam(t, 'type', builtIn ? ['defaultLibrary'] : undefined);
            } else {
                visitAll(members);
            }
            visitAll(fields(node, 'function'));
        },

        component_decl(node) {
            add(field(node, 'name'), 'namespace', ['declaration']);
            visitAll(fields(node, 'members'));
        },

        class_decl(node) {
            const name = field(node, 'name');
            if (name) visitIdentParam(name, 'class', ['declaration']);
            visit(field(node, 'parameters'));
            visit(field(node, 'extendsType'));
            visit(field(node, 'extendsTypeParams'));
            visitAll(fields(node, 'members'));
        },

        enum_decl(node) {
            add(field(node, 'name'), 'enum', ['declaration']);
            visit(field(node, 'parameters'));
            visitNamedChildren(field(node, 'cases'));
        },

        enum_case(node) {
            add(field(node, 'name'), 'enumMember');
            visitAll(fields(node, 'parameters'));
        },

        variant_decl(node) {
            const name = field(node, 'name');
            if (name) visitIdentParam(name, 'enum', ['declaration']);
            visit(field(node, 'decls'));
            visitAll(fields(node, 'members'));
        },

        variant_case(node) {
            add(field(node, 'name'), 'enumMember');
            visit(field(node, 'decls'));
            visitAll(fields(node, 'method'));
        },

        var_member(node) {
            const decls = field(node, 'decls');
            if (decls) for (const d of decls.namedChildren) if (d) visitVarDecl(d, 'property');
        },

        method(node) {
            const name = field(node, 'name');
            if (name) visitIdentParam(name, 'method');
            visit(field(node, 'parameters'));
            visit(field(node, 'returnType'));
            visit(field(node, 'body'));
        },

        fun_expr(node) {
            visit(field(node, 'parameters'));
            visit(field(node, 'returnType'));
            visitAll(node.namedChildren.filter(n => n != null && n.type == 'expr' || n?.type == 'block_stmt'));
        },

        var_decl(node) {
            visitVarDecl(node, 'variable');
        },

        // f(...) : color the callee identifier as a method.
        apply_suffix(node) {
            const callee = node.parent?.previousNamedSibling?.child(0)?.namedChild(0);
            if (callee && callee.type == 'ident_param') visitIdentParam(callee, 'method');
            visitNamedChildren(node);
        },
    };

    function visit(node: Node | null) {
        if (node == null) return;
        const v = visitors[node.type];
        if (v) v(node);
        else visitNamedChildren(node);
    }

    visit(root);
}
