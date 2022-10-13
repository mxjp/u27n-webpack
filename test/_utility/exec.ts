/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { spawn } from "node:child_process";
import EventEmitter from "node:events";

import { ExecutionContext } from "ava";

export interface ExecOptions {
	t: ExecutionContext;
	cwd: string;
	command: string[];
	timeout?: number;
	silent?: boolean;
	ignoreStatus?: boolean;
	signal?: AbortSignal;
	events?: EventEmitter;
}

export interface ExecResult {
	stdout: string;
	stderr: string;
}

export function exec(options: ExecOptions): Promise<ExecResult> {
	return new Promise((resolve, reject) => {
		const ipc: ["ipc"] | [] = options.events ? ["ipc"] : [];
		const proc = spawn(options.command[0], options.command.slice(1), {
			cwd: options.cwd,
			shell: false,
			stdio: options.silent ? ["ignore", "pipe", "pipe", ...ipc] : ["ignore", 1, 2, ...ipc],
		});

		let stdout = "";
		let stderr = "";
		let output = "";

		if (options.signal) {
			options.signal.addEventListener("abort", () => proc.kill());
		}

		if (options.silent) {
			proc.stdout?.setEncoding("utf-8");
			proc.stdout?.on("data", chunk => {
				output += chunk;
				stdout += chunk;
			});
			proc.stderr?.setEncoding("utf-8");
			proc.stderr?.on("data", chunk => {
				output += chunk;
				stderr += chunk;
			});
		}

		if (options.events) {
			proc.on("message", (msg: any) => {
				if (typeof msg.type === "string") {
					options.events!.emit(msg.type, msg);
				}
			});
		}

		proc.on("spawn", () => {
			if (options.signal?.aborted) {
				proc.kill();
			}
		});

		proc.on("exit", (code, signal) => {
			clearTimeout(timeout);
			const status = code ?? signal;
			if (options.ignoreStatus || !status) {
				resolve({
					stdout,
					stderr,
				});
			} else {
				if (options.silent) {
					options.t.log(output);
				}
				reject(status);
			}
		});

		const timeout = setTimeout(() => {
			options.t.log("Process timed out.");
			proc.kill();
		}, options.timeout ?? 30000);
	});
}

export async function execPipeline(options: ExecOptions, pipeline: (events: EventEmitter) => Promise<void>): Promise<void> {
	const controller = new AbortController();
	const events = new EventEmitter();

	const exit = exec({
		...options,
		events,
		signal: controller.signal,
	});

	try {
		await pipeline(events);
	} finally {
		controller.abort();
		await exit;
	}
}
