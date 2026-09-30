// Copyright 2024 Virgil Authors. All rights reserved.
// See LICENSE for details of Apache 2.0 license.
//
// Drives the compiler's built-in interpreter debugger (`v3c -debug -debug-extension`) over stdin/stdout.
// The line protocol is produced by aeneas/src/ssa/SsaDebugger.v3.
import { EventEmitter } from 'events';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { debug } from 'vscode';

export interface RuntimeStackFrame {
    index: number;
    name: string;
    file: string;
    line: number;
}

export interface RuntimeBreakpoint {
    id: number;
    line: number;
    verified: boolean;
    ts: number;
    enable: boolean;
}

export interface RuntimeVariable {
    name: string;
    type: string;
    value: string;
    reference: boolean;
    idx: number[];
}

export class DebuggerConnector extends EventEmitter {
    private process!: ChildProcessWithoutNullStreams;
    private stopOnEntry = false;
    private stacktrace: RuntimeStackFrame[] = [];
    private variables: RuntimeVariable[] = [];
    private variableIdx: number[] = [];
    private breakpoints = new Map<string, Map<number, RuntimeBreakpoint>>();
    private breakpointTs = 0;
    private output = '';

    start(command: string, program: string[], stopOnEntry: boolean): void {
        this.stopOnEntry = stopOnEntry;
        const args = ['-debug', '-debug-extension', ...program];
        this.process = spawn(command, args);

        this.process.stdout.on('data', data => {
            this.output += data;
            for (const line of data.toString().split('\n')) {
                if (line) this.parseLine(line);
            }
        });
        this.process.stderr.on('data', data => debug.activeDebugConsole.appendLine(data.toString()));
        this.process.on('error', error => {
            debug.activeDebugConsole.appendLine(`${error.name}: ${error.message}`);
            this.sendEvent('end');
        });
        this.process.on('close', code => {
            if (code != 0) {
                debug.activeDebugConsole.appendLine(this.output);
                debug.activeDebugConsole.appendLine('exit');
            }
            this.sendEvent('end');
        });
    }

    startDebuggee() {
        this.send(this.stopOnEntry ? 'start' : 'run');
        this.requestStackTrace();
        this.requestVariables();
    }

    disconnect() {
        this.send('q');
    }

    step(cmd: string) {
        this.send(cmd);
        this.requestStackTrace();
        this.requestVariables();
    }

    stack(): RuntimeStackFrame[] {
        return this.stacktrace.slice();
    }

    getLocalVariables(): RuntimeVariable[] {
        return this.variables;
    }

    async getLocalVariable(idx: number[]): Promise<RuntimeVariable[]> {
        this.variables = [];
        this.variableIdx = idx;
        this.send(`info variable ${idx.join(' ')}`);
        await this.waitFor('getVariableDone');
        return this.variables;
    }

    async updateBreakpoints(path: string, lines: number[]): Promise<RuntimeBreakpoint[]> {
        this.breakpointTs++;
        let bps = this.breakpoints.get(path);
        if (!bps) {
            bps = new Map<number, RuntimeBreakpoint>();
            this.breakpoints.set(path, bps);
        }
        const known = bps;
        const result = await Promise.all(lines.map(async line => {
            let bp = known.get(line);
            if (!bp) {
                bp = await this.setBreakpoint(path, line);
                if (bp.verified) {
                    bp.ts = this.breakpointTs;
                    known.set(bp.line, bp);
                }
                return bp;
            }
            if (!bp.enable) {
                this.send(`enable ${bp.id}`);
                bp.enable = true;
            }
            bp.ts = this.breakpointTs;
            return bp;
        }));
        for (const bp of known.values()) {
            if (bp.ts != this.breakpointTs && bp.enable) {
                this.send(`disable ${bp.id}`);
                bp.enable = false;
            }
        }
        return result;
    }

    private send(line: string) {
        this.process.stdin.write(line + '\n');
    }

    private requestStackTrace() {
        this.stacktrace = [];
        this.send('bt');
    }

    private requestVariables() {
        this.variables = [];
        this.variableIdx = [];
        this.send('info l');
    }

    private async setBreakpoint(path: string, line: number): Promise<RuntimeBreakpoint> {
        this.send(`b ${path} ${line}`);
        const id = await this.waitFor(`setBreakDone${path} ${line}`);
        if (id == -1) return { id, line, verified: false, ts: 0, enable: false };
        return { id, line, verified: true, ts: 0, enable: true };
    }

    private waitFor(event: string): Promise<number> {
        return new Promise(resolve => this.once(event, (idx: number) => resolve(idx)));
    }

    private parseLine(data: string) {
        const par = data.split('|');
        switch (par[0]) {
            case 'stop':
                this.sendEvent(par[1]);
                break;
            case 'bt':
                this.stacktrace.push({ index: 0, name: par[1], file: par[2], line: parseInt(par[3]) });
                break;
            case 'breakpoint':
                this.sendEvent('setBreakDone' + par[1], parseInt(par[2]));
                break;
            case 'variable':
                this.variables.push({
                    idx: this.variableIdx.concat(parseInt(par[1])),
                    name: par[2],
                    value: par[3],
                    type: par[4],
                    reference: par[5] == 'true',
                });
                break;
            case 'variableDone':
                this.sendEvent('getVariableDone', 0);
                break;
            case 'result':
                debug.activeDebugConsole.appendLine('Program exited with result: ' + par[1]);
                break;
        }
    }

    private sendEvent(event: string, ...args: any[]): void {
        setTimeout(() => this.emit(event, ...args), 0);
    }
}
