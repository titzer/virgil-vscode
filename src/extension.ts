// Copyright 2024 Virgil Authors. All rights reserved.
// See LICENSE for details of Apache 2.0 license.
import * as vscode from 'vscode';
import { SemanticHighlighter } from './highlight';
import { registerDebugger } from './debug/adapter';

export async function activate(context: vscode.ExtensionContext) {
    registerDebugger(context);
    try {
        const highlighter = await SemanticHighlighter.create(context.extensionUri.fsPath);
        context.subscriptions.push(highlighter.register());
    } catch (e) {
        // TextMate highlighting (contributed declaratively) and the debugger still work.
        console.error('virgil: semantic highlighting unavailable:', e);
    }
}

export function deactivate() {}
