// Copyright 2024 Virgil Authors. All rights reserved.
// See LICENSE for details of Apache 2.0 license.
//
// Debug Adapter Protocol implementation, run in-process in the extension host.
import * as vscode from 'vscode';
import {
    Logger, logger, LoggingDebugSession, InitializedEvent, StoppedEvent, Thread, Source, StackFrame,
    TerminatedEvent, Handles, Scope,
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { basename } from 'path';
import { DebuggerConnector, RuntimeVariable } from './connector';

interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    /** Path to the Virgil compiler used as the debugger. */
    debugger?: string;
    /** Source files of the program to debug. */
    program: string[] | string;
    /** Stop at the start of main(). */
    stopOnEntry?: boolean;
    /** Log Debug Adapter Protocol traffic. */
    trace?: boolean;
}

export function registerDebugger(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('virgil', {
        provideDebugConfigurations(): vscode.DebugConfiguration[] {
            return [{
                name: 'Debug current Virgil file',
                request: 'launch',
                type: 'virgil',
                debugger: 'v3c',
                program: ['${file}'],
                stopOnEntry: true,
            }];
        }
    }, vscode.DebugConfigurationProviderTriggerKind.Dynamic));

    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('virgil', {
        createDebugAdapterDescriptor() {
            return new vscode.DebugAdapterInlineImplementation(new VirgilDebugSession());
        }
    }));
}

/** A one-shot latch: `wait()` resolves once `notify()` has been called. */
class Latch {
    private resolve!: () => void;
    private promise = new Promise<void>(r => this.resolve = r);
    notify() { this.resolve(); }
    wait() { return this.promise; }
}

class VirgilDebugSession extends LoggingDebugSession {
    private static THREAD_ID = 1;
    private runtime = new DebuggerConnector();
    private configurationDone = new Latch();
    private variableHandles = new Handles<'locals' | RuntimeVariable>();

    constructor() {
        super();
        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(true);

        this.runtime.on('stopOnEntry', () => this.sendEvent(new StoppedEvent('entry', VirgilDebugSession.THREAD_ID)));
        this.runtime.on('stopOnStep', () => this.sendEvent(new StoppedEvent('step', VirgilDebugSession.THREAD_ID)));
        this.runtime.on('stopOnBreakpoint', () => this.sendEvent(new StoppedEvent('breakpoint', VirgilDebugSession.THREAD_ID)));
        this.runtime.on('end', () => this.sendEvent(new TerminatedEvent()));
    }

    protected initializeRequest(response: DebugProtocol.InitializeResponse): void {
        response.body = response.body || {};
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsRestartRequest = true;
        this.sendResponse(response);
        this.sendEvent(new InitializedEvent());
    }

    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
        super.configurationDoneRequest(response, args);
        this.configurationDone.notify();
    }

    protected disconnectRequest(response: DebugProtocol.DisconnectResponse): void {
        this.runtime.disconnect();
        this.sendResponse(response);
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
        logger.setup(args.trace ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false);
        const program = Array.isArray(args.program) ? args.program : [args.program];
        this.runtime.start(args.debugger || 'v3c', program, !!args.stopOnEntry);
        await this.configurationDone.wait();
        this.runtime.startDebuggee();
        this.sendResponse(response);
    }

    protected restartRequest(response: DebugProtocol.RestartResponse): void {
        this.runtime.startDebuggee();
        this.sendResponse(response);
    }

    protected continueRequest(response: DebugProtocol.ContinueResponse): void {
        this.runtime.step('c');
        this.sendResponse(response);
    }

    protected nextRequest(response: DebugProtocol.NextResponse): void {
        this.runtime.step('n');
        this.sendResponse(response);
    }

    protected stepInRequest(response: DebugProtocol.StepInResponse): void {
        this.runtime.step('s');
        this.sendResponse(response);
    }

    protected stepOutRequest(response: DebugProtocol.StepOutResponse): void {
        this.runtime.step('fin');
        this.sendResponse(response);
    }

    protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): Promise<void> {
        const path = args.source.path as string;
        const breakpoints = await this.runtime.updateBreakpoints(path, args.lines || []);
        response.body = { breakpoints };
        this.sendResponse(response);
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        response.body = { threads: [new Thread(VirgilDebugSession.THREAD_ID, 'main')] };
        this.sendResponse(response);
    }

    protected stackTraceRequest(response: DebugProtocol.StackTraceResponse): void {
        const frames = this.runtime.stack();
        response.body = {
            stackFrames: frames.map(f => new StackFrame(
                f.index, f.name, this.createSource(f.file), this.convertDebuggerLineToClient(f.line))),
            totalFrames: frames.length,
        };
        this.sendResponse(response);
    }

    private createSource(filePath: string): Source {
        return new Source(basename(filePath), this.convertDebuggerPathToClient(filePath));
    }

    protected scopesRequest(response: DebugProtocol.ScopesResponse): void {
        response.body = { scopes: [new Scope('Locals', this.variableHandles.create('locals'), false)] };
        this.sendResponse(response);
    }

    protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): Promise<void> {
        let vars: RuntimeVariable[] = [];
        const v = this.variableHandles.get(args.variablesReference);
        if (v === 'locals') vars = this.runtime.getLocalVariables();
        else if (v) vars = await this.runtime.getLocalVariable(v.idx);
        response.body = { variables: vars.map(v => this.convertVariable(v)) };
        this.sendResponse(response);
    }

    private convertVariable(v: RuntimeVariable): DebugProtocol.Variable {
        let value = v.value;
        if (v.type == 'float') value = hexToFloat32(v.value.split(':')[1]).toString();
        const result: DebugProtocol.Variable = { name: v.name, value, type: v.type, variablesReference: 0 };
        if (v.reference) result.variablesReference = this.variableHandles.create(v);
        return result;
    }
}

function hexToFloat32(hex: string): number {
    const buf = new DataView(new ArrayBuffer(4));
    buf.setUint32(0, parseInt(hex, 16) >>> 0);
    return buf.getFloat32(0);
}
